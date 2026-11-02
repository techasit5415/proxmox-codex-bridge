import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import { saveTaskToHistory } from '../../../lib/history';
import { detectTaskType } from '../../../lib/types';

const execAsync = util.promisify(exec);
const WORKSPACES_DIR = '/opt/agent-bridge/workspaces';
const KMITL_API_URL = 'https://aipass.cskmitl.com/api/chat';
const KMITL_TOKEN = 'gpu_910c7fbfed984909803659c2885e0d320746a068';
const DEEPSEEK_MODEL = 'deepseek-r1:14b';

function getLatestTokenUsage() {
	const baseDir = '/root/.codex/sessions';
	if (!fs.existsSync(baseDir)) return null;

	function getFiles(dir: string): string[] {
		let files: string[] = [];
		try {
			fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
				const fullPath = path.join(dir, entry.name);
				if (entry.isDirectory()) files = files.concat(getFiles(fullPath));
				else if (entry.name.endsWith('.jsonl')) files.push(fullPath);
			});
		} catch (e) {}
		return files;
	}

	const allFiles = getFiles(baseDir);
	if (allFiles.length === 0) return null;
	allFiles.sort((a, b) => {
		try {
			return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
		} catch {
			return 0;
		}
	});
	const latestFile = allFiles[0];

	try {
		const lines = fs.readFileSync(latestFile, 'utf8').split('\n');
		let lastUsage: any = null;
		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const parsed = JSON.parse(line);
				const payload = parsed.payload;
				if (payload?.info?.total_token_usage) lastUsage = payload.info.total_token_usage;
				else if (payload?.token_usage) lastUsage = payload.token_usage;
			} catch (e) {}
		}
		return lastUsage;
	} catch (e) {
		return null;
	}
}

interface WorktreeContext {
	worktreePath: string;
	branchName: string;
	baseCommit: string;
}

function sanitizeForApi(text: string, maxChars = 4000): string {
	if (!text) return '';
	let clean = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
	                .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '');
	if (clean.length > maxChars) {
		clean = clean.slice(0, maxChars) + '\n...[truncated for token limit]';
	}
	return clean;
}

async function prepareWorktree(repoDir: string, branchName: string, prefix: string): Promise<WorktreeContext> {
	try {
		await execAsync('git rev-parse HEAD', { cwd: repoDir });
	} catch (e) {
		await execAsync('git init && git add -A && git commit -m "init workspace" --allow-empty', { cwd: repoDir });
	}

	const { stdout: headOut } = await execAsync('git rev-parse HEAD', { cwd: repoDir });
	const baseCommit = headOut.trim();

	const excludeFile = path.join(repoDir, '.git', 'info', 'exclude');
	try {
		let excl = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : '';
		if (!excl.includes('.worktrees')) {
			fs.appendFileSync(excludeFile, '\n.worktrees\n.worktrees/**\n');
		}
	} catch (e) {}

	const worktreesBase = path.join(repoDir, '.worktrees');
	if (!fs.existsSync(worktreesBase)) {
		fs.mkdirSync(worktreesBase, { recursive: true });
	}

	const ts = Date.now();
	const rand = Math.random().toString(36).substring(2, 6);
	const worktreePath = path.join(worktreesBase, `${prefix}-${ts}-${rand}`);

	await execAsync(`git worktree add -B "${branchName}" "${worktreePath}" ${baseCommit}`, { cwd: repoDir });

	return { worktreePath, branchName, baseCommit };
}

async function cleanupWorktree(repoDir: string, ctx: WorktreeContext, commitMsg?: string) {
	try {
		if (commitMsg && fs.existsSync(ctx.worktreePath)) {
			try {
				await execAsync(`git add -A && git commit -m "${commitMsg.replace(/"/g, '\\"')}" --allow-empty`, { cwd: ctx.worktreePath });
			} catch (e) {}
		}
	} catch (e) {}

	try {
		await execAsync(`git worktree remove --force "${ctx.worktreePath}"`, { cwd: repoDir });
	} catch (e) {
		try {
			if (fs.existsSync(ctx.worktreePath)) {
				fs.rmSync(ctx.worktreePath, { recursive: true, force: true });
			}
		} catch (err) {}
	}

	try {
		await execAsync('git worktree prune', { cwd: repoDir });
	} catch (e) {}
}

async function runCodexTask(target: string, prompt: string, branchName: string, cwdOverride?: string) {
	const runDir = cwdOverride || target;
	if (!cwdOverride) {
		try {
			await execAsync(`git checkout -b ${branchName}`, { cwd: target });
		} catch (e) {}
	}

	const taskType = detectTaskType(prompt);
	const effectivePrompt = taskType === 'general'
		? `[TASK TYPE: GENERAL CONSULTATION / ADVISORY / PLANNING]
Note: This is a general query, planning, or advisory question (NOT a file-editing code task).
Please respond directly, thoroughly, and comprehensively to the user's question in the requested language (e.g. Thai).
Do NOT attempt to search workspace files with rg/find or edit files unless explicitly instructed.

User Question:
${prompt}`
		: prompt;

	const promptFile = `/tmp/codex_prompt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.txt`;
	fs.writeFileSync(promptFile, effectivePrompt, 'utf8');

	const codexCmd = `cat "${promptFile}" | codex exec --dangerously-bypass-approvals-and-sandbox -C "${runDir}" -`;

	let stdout = '';
	let stderr = '';
	try {
		const res = await execAsync(codexCmd, {
			timeout: 15 * 60 * 1000,
			maxBuffer: 20 * 1024 * 1024,
			env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }
		});
		stdout = res.stdout;
		stderr = res.stderr;
	} finally {
		try { fs.unlinkSync(promptFile); } catch (e) {}
	}
	const { stdout: diff } = await execAsync('git diff', { cwd: runDir });
	const { stdout: status } = await execAsync('git status -s', { cwd: runDir });
	const tokens = getLatestTokenUsage();

	return {
		provider: 'Codex (gpt-6.1-sol)',
		branch: branchName,
		status: status.trim() || 'Clean',
		diff: diff.trim() || '(No tracked files modified)',
		logs: (stdout + '\n' + stderr).trim(),
		tokens: tokens || { total_tokens: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 }
	};
}

async function runDeepSeekTask(target: string, prompt: string, branchName: string, cwdOverride?: string) {
	const runDir = cwdOverride || target;
	if (!cwdOverride) {
		try {
			await execAsync(`git checkout -b ${branchName}`, { cwd: target });
		} catch (e) {}
	}

	const taskType = detectTaskType(prompt);
	let fileList = '';
	try {
		const { stdout } = await execAsync('git ls-files | head -n 40', { cwd: runDir });
		fileList = stdout;
	} catch (e) {}
	
	const systemPrompt = taskType === 'general'
		? `You are an expert AI advisor and assistant. The user is asking a general planning, advisory, or analytical question.
Provide a clear, detailed, well-structured, and comprehensive response in the requested language (e.g. Thai).
Do NOT format your response as code files or file: blocks unless specifically requested.`
		: `You are an expert software engineer. Given a user task and workspace files, generate the necessary code changes.
For each file you create or modify, format your response strictly using this syntax:

file:path/to/file.ext
\`\`\`language
<complete file content here>
\`\`\`

Do not output git diff markers directly, just output the complete file contents inside the file: block.`;

	const userContent = taskType === 'general'
		? prompt
		: `Workspace files:\n${fileList}\n\nTask:\n${prompt}`;

	const res = await fetch(KMITL_API_URL, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${KMITL_TOKEN}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model: DEEPSEEK_MODEL,
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userContent }
			],
			stream: true
		})
	});

	if (!res.ok) {
		const errText = await res.text();
		throw new Error(`KMITL API Error (${res.status}): ${errText}`);
	}

	const reader = res.body?.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let thinking = '';
	let reply = '';
	let promptTokens = 35;
	let completionTokens = 0;
	let cachedTokens = 0;

	if (reader) {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const json = JSON.parse(line);
					if (json.message?.thinking) thinking += json.message.thinking;
					if (json.message?.content) reply += json.message.content;
					if (json.prompt_eval_count) promptTokens = json.prompt_eval_count;
					if (json.eval_count) completionTokens = json.eval_count;
					if (json.prompt_eval_cached_count) cachedTokens = json.prompt_eval_cached_count;
				} catch (e) {}
			}
		}
	}

	const fullLogs = thinking ? `<think>\n${thinking}\n</think>\n\n${reply}` : reply;
	const totalTokens = promptTokens + completionTokens;

	// Parse file blocks and write to disk
	let modifiedFiles = 0;
	const regex = /(?:file:([^\n\r]+)[\r\n]+)?```[a-zA-Z0-9_\-]*[\r\n]+([\s\S]*?)```/g;
	let match;
	while ((match = regex.exec(reply)) !== null) {
		let filePath = match[1]?.trim();
		const fileContent = match[2];
		
		if (!filePath) {
			const firstLine = fileContent.trim().split('\n')[0];
			if (firstLine.startsWith('//') || firstLine.startsWith('#')) {
				const candidate = firstLine.replace(/^(\/\/|#)\s*/, '').trim();
				if (candidate.includes('.') && !candidate.includes(' ')) {
					filePath = candidate;
				}
			}
		}

		if (filePath) {
			const absPath = path.join(runDir, filePath);
			fs.mkdirSync(path.dirname(absPath), { recursive: true });
			fs.writeFileSync(absPath, fileContent, 'utf8');
			modifiedFiles++;
		}
	}

	const { stdout: diff } = await execAsync('git diff', { cwd: runDir });
	const { stdout: status } = await execAsync('git status -s', { cwd: runDir });

	return {
		provider: 'DeepSeek R1 (14b GPU)',
		branch: branchName,
		status: status.trim() || 'Clean',
		diff: diff.trim() || (modifiedFiles > 0 ? `(${modifiedFiles} files created/modified - untracked)` : '(No files modified)'),
		logs: fullLogs.trim(),
		tokens: {
			total_tokens: totalTokens,
			input_tokens: promptTokens,
			cached_input_tokens: cachedTokens,
			output_tokens: completionTokens
		}
	};
}

function slugifyPrompt(prompt: string): string {
	const clean = (prompt || '')
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 35);
	const id = Math.random().toString(36).substring(2, 6);
	return `temp-${clean || 'scratch'}-${id}`;
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { workspace, prompt, branch, provider = 'codex' } = await request.json();
		if (!prompt?.trim()) {
			return json({ error: 'prompt is required' }, { status: 400 });
		}

		let activeWorkspace = workspace?.trim();
		if (!activeWorkspace || activeWorkspace === 'auto-temp' || activeWorkspace === 'temp') {
			activeWorkspace = slugifyPrompt(prompt);
			const tempTarget = path.join(WORKSPACES_DIR, activeWorkspace);
			if (!fs.existsSync(tempTarget)) {
				fs.mkdirSync(tempTarget, { recursive: true });
				const cleanTitle = prompt.replace(/[\r\n]+/g, ' ').slice(0, 100);
				const readme = `# ${cleanTitle}\n\nAutomated scratch workspace created for prompt:\n> ${prompt}\n`;
				fs.writeFileSync(path.join(tempTarget, 'README.md'), readme, 'utf8');
				try {
					await execAsync('git init && git add README.md && git commit -m "init: automated scratch workspace"', { cwd: tempTarget });
				} catch (e) {}
			}
		}

		const target = path.join(WORKSPACES_DIR, activeWorkspace);
		if (!fs.existsSync(target)) {
			return json({ error: `Workspace '${activeWorkspace}' not found` }, { status: 404 });
		}

		const timestamp = Date.now();

		// Provider: DeepSeek R1 Only
		if (provider === 'deepseek') {
			const taskBranch = branch?.trim() || `agent/deepseek-${timestamp}`;
			const result = await runDeepSeekTask(target, prompt, taskBranch);
			saveTaskToHistory({
				workspace: activeWorkspace,
				prompt,
				provider: result.provider,
				branch: result.branch,
				status: result.status,
				diff: result.diff,
				logs: result.logs,
				tokens: result.tokens,
				mode: 'single'
			});
			return json({ success: true, workspace: activeWorkspace, mode: 'single', ...result });
		}

		// Provider: Both (Dual Comparison with Git Worktrees)
		if (provider === 'both') {
			const codexBranch = `agent/codex-${timestamp}`;
			const deepseekBranch = `agent/deepseek-${timestamp}`;

			// Create isolated worktrees for both agents so they never conflict
			const codexWorktree = await prepareWorktree(target, codexBranch, 'codex');
			const deepseekWorktree = await prepareWorktree(target, deepseekBranch, 'deepseek');

			let codexRes: any;
			let deepseekRes: any;

			try {
				const deepseekPromise = runDeepSeekTask(target, prompt, deepseekBranch, deepseekWorktree.worktreePath)
					.catch(err => ({
						provider: 'DeepSeek R1 (14b GPU)',
						branch: deepseekBranch,
						status: 'Failed',
						diff: '',
						logs: `DeepSeek Error: ${err.message}`,
						tokens: { total_tokens: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 }
					}));

				codexRes = await runCodexTask(target, prompt, codexBranch, codexWorktree.worktreePath);
				deepseekRes = await deepseekPromise;
			} finally {
				// Commit changes to each branch in git and cleanup worktrees
				await cleanupWorktree(target, codexWorktree, `Codex: ${prompt.slice(0, 50)}`);
				await cleanupWorktree(target, deepseekWorktree, `DeepSeek: ${prompt.slice(0, 50)}`);
			}

			saveTaskToHistory({
				workspace: activeWorkspace,
				prompt,
				provider: 'Dual Agents (Codex + DeepSeek)',
				branch: `${codexBranch} & ${deepseekBranch}`,
				status: 'Dual Completed',
				diff: codexRes.diff,
				logs: `=== CODEX LOGS ===\n${codexRes.logs}\n\n=== DEEPSEEK LOGS ===\n${deepseekRes.logs}`,
				tokens: {
					total_tokens: (codexRes.tokens?.total_tokens || 0) + (deepseekRes.tokens?.total_tokens || 0),
					input_tokens: (codexRes.tokens?.input_tokens || 0) + (deepseekRes.tokens?.input_tokens || 0),
					cached_input_tokens: (codexRes.tokens?.cached_input_tokens || 0),
					output_tokens: (codexRes.tokens?.output_tokens || 0) + (deepseekRes.tokens?.output_tokens || 0)
				},
				mode: 'both',
				codex: codexRes,
				deepseek: deepseekRes
			});

			return json({
				success: true,
				workspace: activeWorkspace,
				mode: 'both',
				codex: codexRes,
				deepseek: deepseekRes
			});
		}

		// Provider: Multi-Agent Consensus Loop (Proposals -> Peer Review -> Harmonization)
		if (provider === 'consensus') {
			const codexPropBranch = `agent/codex-prop-${timestamp}`;
			const deepseekPropBranch = `agent/deepseek-prop-${timestamp}`;
			const consensusBranch = branch?.trim() || `agent/consensus-${timestamp}`;

			// STAGE 1: Parallel Generation in isolated worktrees
			const codexWorktree = await prepareWorktree(target, codexPropBranch, 'codex-prop');
			const deepseekWorktree = await prepareWorktree(target, deepseekPropBranch, 'deepseek-prop');

			let codexProp: any;
			let deepseekProp: any;

			try {
				const deepseekPromise = runDeepSeekTask(target, prompt, deepseekPropBranch, deepseekWorktree.worktreePath)
					.catch(err => ({
						provider: 'DeepSeek R1 (14b GPU)',
						branch: deepseekPropBranch,
						status: 'Failed',
						diff: '',
						logs: `DeepSeek Error: ${err.message}`,
						tokens: { total_tokens: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 }
					}));

				codexProp = await runCodexTask(target, prompt, codexPropBranch, codexWorktree.worktreePath);
				deepseekProp = await deepseekPromise;
			} finally {
				await cleanupWorktree(target, codexWorktree, `Codex Proposal: ${prompt.slice(0, 50)}`);
				await cleanupWorktree(target, deepseekWorktree, `DeepSeek Proposal: ${prompt.slice(0, 50)}`);
			}

			// STAGE 2: Bilateral Cross-Review (Peer Review)
			const deepseekReviewPrompt = `[PEER REVIEW REQUEST]
You are a Principal Software Architect & Auditor conducting a peer review of a solution proposed by OpenAI Codex for the following task.

=== ORIGINAL TASK ===
${prompt}

=== CODEX'S PROPOSAL & OUTPUT ===
${sanitizeForApi(codexProp.logs, 4000)}

=== CODEX'S GIT DIFF ===
${codexProp.diff || '(No diff recorded)'}

Please provide your rigorous peer review in Thai (and English for technical terms):
1. จุดเด่นของแนวทางนี้ (Key Strengths)
2. จุดบกพร่อง ช่องโหว่ หรือ Edge Cases ที่อาจเกิดขึ้น (Flaws, Vulnerabilities & Edge Cases)
3. ข้อเสนอแนะในการปรับปรุงให้สมบูรณ์ยิ่งขึ้น (Actionable Improvements)`;

			const codexReviewPrompt = `[TASK TYPE: GENERAL CONSULTATION / PEER REVIEW AUDIT]
You are a Principal Software Architect & Auditor conducting a peer review of a solution proposed by DeepSeek R1 for the following task.

=== ORIGINAL TASK ===
${prompt}

=== DEEPSEEK R1 PROPOSAL & OUTPUT ===
${sanitizeForApi(deepseekProp.logs, 6000)}

=== DEEPSEEK R1 GIT DIFF ===
${deepseekProp.diff || '(No diff recorded)'}

Please provide your rigorous peer review in Thai (and English for technical terms):
1. จุดเด่นของแนวทางนี้ (Key Strengths)
2. จุดบกพร่อง ช่องโหว่ หรือ Edge Cases ที่อาจเกิดขึ้น (Flaws, Vulnerabilities & Edge Cases)
3. ข้อเสนอแนะในการปรับปรุงให้สมบูรณ์ยิ่งขึ้น (Actionable Improvements)`;

			// Run reviews concurrently
			const deepseekReviewPromise = (async () => {
				const res = await fetch(KMITL_API_URL, {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${KMITL_TOKEN}`,
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						model: DEEPSEEK_MODEL,
						messages: [
							{ role: 'system', content: 'You are a Senior Software Architect and Code Auditor providing high-standard constructive peer reviews in Thai.' },
							{ role: 'user', content: deepseekReviewPrompt }
						],
						stream: false
					})
				});
				if (!res.ok) {
					const errText = await res.text().catch(() => '');
					console.error(`[DeepSeek Review Error] HTTP ${res.status} ${res.statusText}: ${errText}`);
					return `DeepSeek Review failed (${res.status} ${res.statusText}): ${errText || 'Empty error body'}`;
				}
				const data = await res.json();
				const msg = data.message?.content || data.choices?.[0]?.message?.content || '';
				const think = data.message?.thinking ? `<think>\n${data.message.thinking}\n</think>\n\n` : '';
				return (think + msg).trim();
			})().catch(err => `DeepSeek Review Error: ${err.message}`);

			const codexReviewPromise = (async () => {
				const promptFile = `/tmp/codex_rev_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.txt`;
				fs.writeFileSync(promptFile, codexReviewPrompt, 'utf8');
				try {
					const res = await execAsync(`cat "${promptFile}" | codex exec --dangerously-bypass-approvals-and-sandbox -C "${target}" -`, {
						timeout: 5 * 60 * 1000,
						maxBuffer: 10 * 1024 * 1024,
						env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }
					});
					return (res.stdout + '\n' + res.stderr).trim();
				} finally {
					try { fs.unlinkSync(promptFile); } catch (e) {}
				}
			})().catch(err => `Codex Review Error: ${err.message}`);

			const [deepseekReviewOfCodex, codexReviewOfDeepSeek] = await Promise.all([
				deepseekReviewPromise,
				codexReviewPromise
			]);

			// STAGE 3: Consensus Harmonization & Final Implementation
			const consensusPrompt = `[TASK TYPE: CONSENSUS HARMONIZATION & FINAL IMPLEMENTATION]
You are the Lead Consensus Multi-Agent Orchestrator.
We have executed a multi-agent debate and peer review between OpenAI Codex and DeepSeek R1.

=== ORIGINAL TASK ===
${prompt}

=== PROPOSAL A (Codex) ===
${codexProp.logs.slice(0, 5000)}
Diff: ${codexProp.diff || 'none'}

=== PEER REVIEW OF PROPOSAL A (by DeepSeek R1) ===
${deepseekReviewOfCodex.slice(0, 3500)}

=== PROPOSAL B (DeepSeek R1) ===
${deepseekProp.logs.slice(0, 5000)}
Diff: ${deepseekProp.diff || 'none'}

=== PEER REVIEW OF PROPOSAL B (by Codex) ===
${codexReviewOfDeepSeek.slice(0, 3500)}

=== YOUR MANDATE ===
1. Synthesize the final agreed solution (Consensus Solution), taking the best parts of both proposals and solving all issues raised in the peer reviews.
2. If this is a Code Task, apply the final, production-ready code directly into the workspace files.
3. Conclude with a clear Consensus Summary explaining what was harmonized and why this consensus is superior to each individual proposal alone.`;

			try {
				await execAsync(`git checkout -b ${consensusBranch}`, { cwd: target });
			} catch (e) {}

			const finalSolution = await runCodexTask(target, consensusPrompt, consensusBranch);

			const consensusData = {
				codexProposal: codexProp,
				deepseekProposal: deepseekProp,
				codexReviewOfDeepSeek,
				deepseekReviewOfCodex,
				finalSolution
			};

			const totalTokens = (codexProp.tokens?.total_tokens || 0) +
				(deepseekProp.tokens?.total_tokens || 0) +
				(finalSolution.tokens?.total_tokens || 0);

			const inputTokens = (codexProp.tokens?.input_tokens || 0) +
				(deepseekProp.tokens?.input_tokens || 0) +
				(finalSolution.tokens?.input_tokens || 0);

			const cachedTokens = (codexProp.tokens?.cached_input_tokens || 0) +
				(finalSolution.tokens?.cached_input_tokens || 0);

			const outputTokens = (codexProp.tokens?.output_tokens || 0) +
				(deepseekProp.tokens?.output_tokens || 0) +
				(finalSolution.tokens?.output_tokens || 0);

			saveTaskToHistory({
				workspace: activeWorkspace,
				prompt,
				provider: 'Multi-Agent Consensus (Codex + DeepSeek)',
				branch: consensusBranch,
				status: 'Consensus Achieved',
				diff: finalSolution.diff,
				logs: `=== CONSENSUS FINAL HARMONIZATION ===\n${finalSolution.logs}\n\n=== PEER REVIEW: DEEPSEEK ON CODEX ===\n${deepseekReviewOfCodex}\n\n=== PEER REVIEW: CODEX ON DEEPSEEK ===\n${codexReviewOfDeepSeek}\n\n=== INITIAL CODEX PROPOSAL ===\n${codexProp.logs}\n\n=== INITIAL DEEPSEEK PROPOSAL ===\n${deepseekProp.logs}`,
				tokens: {
					total_tokens: totalTokens,
					input_tokens: inputTokens,
					cached_input_tokens: cachedTokens,
					output_tokens: outputTokens
				},
				mode: 'consensus',
				consensus: consensusData
			});

			return json({
				success: true,
				workspace: activeWorkspace,
				mode: 'consensus',
				consensus: consensusData,
				branch: consensusBranch,
				status: 'Consensus Achieved',
				diff: finalSolution.diff,
				logs: finalSolution.logs,
				tokens: {
					total_tokens: totalTokens,
					input_tokens: inputTokens,
					cached_input_tokens: cachedTokens,
					output_tokens: outputTokens
				}
			});
		}

		// Default: Codex Only
		const taskBranch = branch?.trim() || `agent/codex-${timestamp}`;
		const result = await runCodexTask(target, prompt, taskBranch);
		saveTaskToHistory({
			workspace: activeWorkspace,
			prompt,
			provider: result.provider,
			branch: result.branch,
			status: result.status,
			diff: result.diff,
			logs: result.logs,
			tokens: result.tokens,
			mode: 'single'
		});
		return json({ success: true, workspace: activeWorkspace, mode: 'single', ...result });
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};
