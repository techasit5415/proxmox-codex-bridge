import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import { saveTaskToHistory } from './history';
import { detectTaskType } from './types';
import type { AIModelConfig, TaskResult, TestEvidence, TaskJobData } from './types';
import { getModels } from './models';

const execAsync = util.promisify(exec);
const WORKSPACES_DIR = '/opt/agent-bridge/workspaces';
const KMITL_API_URL = 'https://aipass.cskmitl.com/api/chat';
const KMITL_TOKEN = 'gpu_910c7fbfed984909803659c2885e0d320746a068';
const DEEPSEEK_MODEL = 'deepseek-r1:14b';

export function getLatestTokenUsage() {
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

export interface WorktreeContext {
	worktreePath: string;
	branchName: string;
	baseCommit: string;
}

export function sanitizeForApi(text: string, maxChars = 4000): string {
	if (!text) return '';
	let clean = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
	                .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '');
	if (clean.length > maxChars) {
		clean = clean.slice(0, maxChars) + '\n...[truncated for token limit]';
	}
	return clean;
}

export async function prepareWorktree(repoDir: string, branchName: string, prefix: string): Promise<WorktreeContext> {
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

export async function cleanupWorktree(repoDir: string, ctx: WorktreeContext, commitMsg?: string) {
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

export async function runTestGate(targetDir: string): Promise<TestEvidence> {
	if (!fs.existsSync(targetDir)) {
		return { ran: false, passed: false, testCmd: 'none', output: 'Workspace does not exist' };
	}

	try {
		// 1. package.json with test script
		const pkgPath = path.join(targetDir, 'package.json');
		if (fs.existsSync(pkgPath)) {
			try {
				const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
				if (pkg.scripts?.test && !pkg.scripts.test.includes('no test specified')) {
					const { stdout, stderr } = await execAsync('npm test', { cwd: targetDir, timeout: 45000 });
					return {
						ran: true,
						passed: true,
						testCmd: 'npm test',
						output: (stdout + '\n' + stderr).trim()
					};
				}
			} catch (err: any) {
				return {
					ran: true,
					passed: false,
					testCmd: 'npm test',
					output: (err.stdout || '') + '\n' + (err.stderr || err.message),
					error: err.message
				};
			}
		}

		// 2. Python pytest or unittest
		const hasPytest = fs.existsSync(path.join(targetDir, 'pytest.ini')) ||
			fs.existsSync(path.join(targetDir, 'tests')) ||
			fs.existsSync(path.join(targetDir, 'test.py'));
		if (hasPytest) {
			try {
				const { stdout, stderr } = await execAsync('pytest -q || python3 -m unittest discover', { cwd: targetDir, timeout: 45000 });
				return {
					ran: true,
					passed: true,
					testCmd: 'pytest / python3 -m unittest',
					output: (stdout + '\n' + stderr).trim()
				};
			} catch (err: any) {
				return {
					ran: true,
					passed: false,
					testCmd: 'pytest / python3 -m unittest',
					output: (err.stdout || '') + '\n' + (err.stderr || err.message),
					error: err.message
				};
			}
		}

		// 3. Fallback: Syntax / Lint verification on modified files
		let diffFiles = '';
		try {
			const res = await execAsync('git diff --name-only HEAD~1 2>/dev/null || git status -s', { cwd: targetDir });
			diffFiles = res.stdout;
		} catch (e) {}

		const files = diffFiles.split('\n').map(f => f.trim().replace(/^..\s+/, '')).filter(Boolean);
		const jsTsFiles = files.filter(f => f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.cjs'));
		const pyFiles = files.filter(f => f.endsWith('.py'));

		const checkOutputs: string[] = [];
		let checkPassed = true;

		for (const f of jsTsFiles.slice(0, 10)) {
			const absF = path.join(targetDir, f);
			if (fs.existsSync(absF)) {
				try {
					await execAsync(`node --check "${absF}"`, { timeout: 10000 });
					checkOutputs.push(`✔ Syntax OK: ${f}`);
				} catch (e: any) {
					checkPassed = false;
					checkOutputs.push(`✖ Syntax Error: ${f}\n${e.stderr || e.message}`);
				}
			}
		}

		for (const f of pyFiles.slice(0, 10)) {
			const absF = path.join(targetDir, f);
			if (fs.existsSync(absF)) {
				try {
					await execAsync(`python3 -m py_compile "${absF}"`, { timeout: 10000 });
					checkOutputs.push(`✔ Syntax OK: ${f}`);
				} catch (e: any) {
					checkPassed = false;
					checkOutputs.push(`✖ Syntax Error: ${f}\n${e.stderr || e.message}`);
				}
			}
		}

		if (checkOutputs.length > 0) {
			return {
				ran: true,
				passed: checkPassed,
				testCmd: 'Automated Syntax Verification',
				output: checkOutputs.join('\n')
			};
		}

		return {
			ran: false,
			passed: true,
			testCmd: 'none',
			output: 'No test suite or script detected; workspace clean.'
		};
	} catch (e: any) {
		return {
			ran: false,
			passed: false,
			testCmd: 'error',
			output: e.message,
			error: e.message
		};
	}
}

export async function runCodexTask(target: string, prompt: string, branchName: string, cwdOverride?: string): Promise<TaskResult> {
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

export async function runDeepSeekTask(target: string, prompt: string, branchName: string, cwdOverride?: string): Promise<TaskResult> {
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

export async function runCustomModelTask(
	modelConfig: AIModelConfig,
	target: string,
	prompt: string,
	branch: string
): Promise<TaskResult> {
	const taskType = detectTaskType(prompt);
	let fileList = '';
	try {
		const { stdout } = await execAsync('git ls-files', { cwd: target });
		fileList = stdout.trim().split('\n').slice(0, 50).join('\n');
	} catch (e) {}

	const systemPrompt = taskType === 'general'
		? `You are an expert AI assistant and advisor. Provide a clear, detailed, and structured response in the requested language (e.g. Thai).`
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

	let reply = '';
	let thinking = '';
	let totalTokens = 0;

	if (modelConfig.type === 'anthropic') {
		const res = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'x-api-key': modelConfig.apiKey || '',
				'anthropic-version': '2023-06-01',
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				model: modelConfig.modelId || 'claude-3-5-sonnet-20241022',
				max_tokens: 4096,
				system: systemPrompt,
				messages: [{ role: 'user', content: userContent }]
			})
		});
		if (!res.ok) {
			const errText = await res.text().catch(() => '');
			throw new Error(`Anthropic API Error (${res.status}): ${errText}`);
		}
		const data = await res.json();
		for (const block of data.content || []) {
			if (block.type === 'text') reply += block.text;
			if (block.type === 'thinking') thinking += block.thinking;
		}
		totalTokens = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
	} else if (modelConfig.type === 'openai-compatible') {
		const endpoint = modelConfig.endpoint || 'https://api.openai.com/v1/chat/completions';
		const res = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${modelConfig.apiKey || ''}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: modelConfig.modelId || 'gpt-4o',
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userContent }
				]
			})
		});
		if (!res.ok) {
			const errText = await res.text().catch(() => '');
			throw new Error(`API Error (${res.status}): ${errText}`);
		}
		const data = await res.json();
		reply = data.choices?.[0]?.message?.content || '';
		totalTokens = data.usage?.total_tokens || 0;
	} else if (modelConfig.type === 'ollama') {
		const endpoint = modelConfig.endpoint || 'http://localhost:11434/api/chat';
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (modelConfig.apiKey) headers['Authorization'] = `Bearer ${modelConfig.apiKey}`;
		const res = await fetch(endpoint, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				model: modelConfig.modelId,
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userContent }
				],
				stream: false
			})
		});
		if (!res.ok) {
			const errText = await res.text().catch(() => '');
			throw new Error(`Ollama Error (${res.status}): ${errText}`);
		}
		const data = await res.json();
		reply = data.message?.content || '';
		if (data.message?.thinking) thinking = data.message.thinking;
		totalTokens = (data.prompt_eval_count || 0) + (data.eval_count || 0);
	}

	let diff = '';
	if (taskType === 'code') {
		const fileRegex = /file:([^\n]+)\s*```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g;
		let match;
		const writtenFiles: string[] = [];
		while ((match = fileRegex.exec(reply)) !== null) {
			const filePath = match[1].trim();
			const fileContent = match[2];
			const fullPath = path.join(target, filePath);
			fs.mkdirSync(path.dirname(fullPath), { recursive: true });
			fs.writeFileSync(fullPath, fileContent, 'utf8');
			writtenFiles.push(filePath);
		}
		if (writtenFiles.length > 0) {
			try {
				await execAsync(`git checkout -b ${branch}`, { cwd: target });
			} catch (e) {}
			await execAsync('git add -A', { cwd: target });
			await execAsync(`git commit -m "${modelConfig.name}: ${prompt.slice(0, 50)}"`, { cwd: target });
			const { stdout: diffOut } = await execAsync('git diff HEAD~1 HEAD', { cwd: target });
			diff = diffOut;
		}
	}

	const thinkSection = thinking ? `<think>\n${thinking}\n</think>\n\n` : '';
	return {
		provider: modelConfig.name,
		branch,
		status: 'Success',
		diff,
		logs: (thinkSection + reply).trim(),
		tokens: {
			total_tokens: totalTokens,
			input_tokens: 0,
			cached_input_tokens: 0,
			output_tokens: totalTokens
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

export async function executeTaskPipeline(
	job: TaskJobData,
	onEvent?: (event: Record<string, any>) => Promise<void>
): Promise<any> {
	const { prompt, branch, provider = 'codex' } = job;
	let activeWorkspace = job.workspace?.trim();

	if (!activeWorkspace || activeWorkspace === 'auto-temp' || activeWorkspace === 'temp') {
		activeWorkspace = slugifyPrompt(prompt);
		job.workspace = activeWorkspace;
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
		throw new Error(`Workspace '${activeWorkspace}' not found`);
	}

	const timestamp = Date.now();
	if (onEvent) await onEvent({ type: 'status', status: 'running', workspace: activeWorkspace });

	// DeepSeek Only
	if (provider === 'deepseek') {
		const taskBranch = branch?.trim() || `agent/deepseek-${timestamp}`;
		if (onEvent) await onEvent({ type: 'stage', stage: 'Executing DeepSeek R1 (14b GPU)...' });
		const result = await runDeepSeekTask(target, prompt, taskBranch);

		if (onEvent) await onEvent({ type: 'stage', stage: 'Running Evidence Test Gate...' });
		const testEvidence = await runTestGate(target);
		result.testEvidence = testEvidence;

		saveTaskToHistory({
			workspace: activeWorkspace,
			prompt,
			provider: result.provider,
			branch: result.branch,
			status: result.status,
			diff: result.diff,
			logs: result.logs,
			tokens: result.tokens,
			mode: 'single',
			testEvidence
		});
		return { success: true, workspace: activeWorkspace, mode: 'single', ...result, testEvidence };
	}

	// Dual Mode (Worktrees)
	if (provider === 'both') {
		const codexBranch = `agent/codex-${timestamp}`;
		const deepseekBranch = `agent/deepseek-${timestamp}`;

		if (onEvent) await onEvent({ type: 'stage', stage: 'Preparing isolated Git worktrees...' });
		const codexWorktree = await prepareWorktree(target, codexBranch, 'codex');
		const deepseekWorktree = await prepareWorktree(target, deepseekBranch, 'deepseek');

		let codexRes: any;
		let deepseekRes: any;

		try {
			if (onEvent) await onEvent({ type: 'stage', stage: 'Running Codex and DeepSeek concurrently...' });
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
			await cleanupWorktree(target, codexWorktree, `Codex: ${prompt.slice(0, 50)}`);
			await cleanupWorktree(target, deepseekWorktree, `DeepSeek: ${prompt.slice(0, 50)}`);
		}

		if (onEvent) await onEvent({ type: 'stage', stage: 'Running Evidence Test Gate...' });
		const testEvidence = await runTestGate(target);

		const combinedTokens = {
			total_tokens: (codexRes.tokens?.total_tokens || 0) + (deepseekRes.tokens?.total_tokens || 0),
			input_tokens: (codexRes.tokens?.input_tokens || 0) + (deepseekRes.tokens?.input_tokens || 0),
			cached_input_tokens: (codexRes.tokens?.cached_input_tokens || 0),
			output_tokens: (codexRes.tokens?.output_tokens || 0) + (deepseekRes.tokens?.output_tokens || 0)
		};

		saveTaskToHistory({
			workspace: activeWorkspace,
			prompt,
			provider: 'Dual Agents (Codex + DeepSeek)',
			branch: `${codexBranch} & ${deepseekBranch}`,
			status: 'Dual Completed',
			diff: codexRes.diff,
			logs: `=== CODEX LOGS ===\n${codexRes.logs}\n\n=== DEEPSEEK LOGS ===\n${deepseekRes.logs}`,
			tokens: combinedTokens,
			mode: 'both',
			codex: codexRes,
			deepseek: deepseekRes,
			testEvidence
		});

		return {
			success: true,
			workspace: activeWorkspace,
			mode: 'both',
			codex: codexRes,
			deepseek: deepseekRes,
			tokens: combinedTokens,
			testEvidence
		};
	}

	// Multi-Agent Consensus Loop
	if (provider === 'consensus') {
		const codexPropBranch = `agent/codex-prop-${timestamp}`;
		const deepseekPropBranch = `agent/deepseek-prop-${timestamp}`;
		const consensusBranch = branch?.trim() || `agent/consensus-${timestamp}`;

		if (onEvent) await onEvent({ type: 'stage', stage: 'Stage 1: Parallel Generation in Worktrees...' });
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
			await cleanupWorktree(target, codexWorktree, `Proposal Codex: ${prompt.slice(0, 50)}`);
			await cleanupWorktree(target, deepseekWorktree, `Proposal DeepSeek: ${prompt.slice(0, 50)}`);
		}

		if (onEvent) await onEvent({ type: 'stage', stage: 'Stage 2: Bilateral Cross-Review...' });
		const deepseekReviewPrompt = `[TASK TYPE: GENERAL CONSULTATION / PEER REVIEW AUDIT]
You are a Principal Software Architect & Auditor conducting a peer review of a solution proposed by OpenAI Codex for the following task.

=== ORIGINAL TASK ===
${prompt}

=== OPENAI CODEX PROPOSAL & OUTPUT ===
${sanitizeForApi(codexProp.logs, 6000)}

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

		if (onEvent) await onEvent({ type: 'stage', stage: 'Stage 3: Consensus Harmonization...' });
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

		if (onEvent) await onEvent({ type: 'stage', stage: 'Stage 4: Automated Evidence Test Gate...' });
		const testEvidence = await runTestGate(target);
		finalSolution.testEvidence = testEvidence;

		const consensusData = {
			codexProposal: codexProp,
			deepseekProposal: deepseekProp,
			codexReviewOfDeepSeek,
			deepseekReviewOfCodex,
			finalSolution,
			testEvidence
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
			consensus: consensusData,
			testEvidence
		});

		return {
			success: true,
			workspace: activeWorkspace,
			mode: 'consensus',
			consensus: consensusData,
			branch: consensusBranch,
			status: 'Consensus Achieved',
			diff: finalSolution.diff,
			logs: finalSolution.logs,
			testEvidence,
			tokens: {
				total_tokens: totalTokens,
				input_tokens: inputTokens,
				cached_input_tokens: cachedTokens,
				output_tokens: outputTokens
			}
		};
	}

	// Custom Registered Models
	const allModels = getModels();
	const matchedModel = allModels.find(m => m.id === provider);
	if (matchedModel && !matchedModel.isBuiltin) {
		const taskBranch = branch?.trim() || `agent/${matchedModel.id}-${timestamp}`;
		if (onEvent) await onEvent({ type: 'stage', stage: `Executing ${matchedModel.name}...` });
		const result = await runCustomModelTask(matchedModel, target, prompt, taskBranch);

		if (onEvent) await onEvent({ type: 'stage', stage: 'Running Evidence Test Gate...' });
		const testEvidence = await runTestGate(target);
		result.testEvidence = testEvidence;

		saveTaskToHistory({
			workspace: activeWorkspace,
			prompt,
			provider: result.provider,
			branch: result.branch,
			status: result.status,
			diff: result.diff,
			logs: result.logs,
			tokens: result.tokens,
			mode: 'single',
			testEvidence
		});
		return { success: true, workspace: activeWorkspace, mode: 'single', ...result, testEvidence };
	}

	// Default: Codex Only
	const taskBranch = branch?.trim() || `agent/codex-${timestamp}`;
	if (onEvent) await onEvent({ type: 'stage', stage: 'Executing OpenAI Codex (gpt-6.1-sol)...' });
	const result = await runCodexTask(target, prompt, taskBranch);

	if (onEvent) await onEvent({ type: 'stage', stage: 'Running Evidence Test Gate...' });
	const testEvidence = await runTestGate(target);
	result.testEvidence = testEvidence;

	saveTaskToHistory({
		workspace: activeWorkspace,
		prompt,
		provider: result.provider,
		branch: result.branch,
		status: result.status,
		diff: result.diff,
		logs: result.logs,
		tokens: result.tokens,
		mode: 'single',
		testEvidence
	});

	return { success: true, workspace: activeWorkspace, mode: 'single', ...result, testEvidence };
}
