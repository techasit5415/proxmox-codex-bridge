import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = util.promisify(exec);
const WORKSPACES_DIR = '/opt/agent-bridge/workspaces';
const KMITL_API_URL = 'https://aipass.cskmitl.com/v1/chat/completions';
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
	allFiles.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
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

async function runCodexTask(target: string, prompt: string, branchName: string) {
	try {
		await execAsync(`git checkout -b ${branchName}`, { cwd: target });
	} catch (e) {}

	const escapedPrompt = prompt.replace(/"/g, '\\"');
	const codexCmd = `codex exec --dangerously-bypass-approvals-and-sandbox -C "${target}" "${escapedPrompt}" </dev/null`;

	const { stdout, stderr } = await execAsync(codexCmd, {
		timeout: 15 * 60 * 1000,
		maxBuffer: 20 * 1024 * 1024
	});
	const { stdout: diff } = await execAsync('git diff', { cwd: target });
	const { stdout: status } = await execAsync('git status -s', { cwd: target });
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

async function runDeepSeekTask(target: string, prompt: string, branchName: string) {
	try {
		await execAsync(`git checkout -b ${branchName}`, { cwd: target });
	} catch (e) {}

	const { stdout: fileList } = await execAsync('git ls-files | head -n 40', { cwd: target });
	
	const systemPrompt = `You are an expert software engineer. Given a user task and workspace files, generate the necessary code changes.
For each file you create or modify, format your response strictly using this syntax:

file:path/to/file.ext
\`\`\`language
<complete file content here>
\`\`\`

Do not output git diff markers directly, just output the complete file contents inside the file: block.`;

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
				{ role: 'user', content: `Workspace files:\n${fileList}\n\nTask:\n${prompt}` }
			],
			stream: false
		})
	});

	if (!res.ok) {
		const errText = await res.text();
		throw new Error(`KMITL API Error (${res.status}): ${errText}`);
	}

	const data = await res.json();
	const reply = data.choices[0]?.message?.content || '';
	const usage = data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

	// Parse file blocks and write to disk
	let modifiedFiles = 0;
	const regex = /(?:file:([^\n\r]+)[\r\n]+)?```[a-zA-Z0-9_\-]*[\r\n]+([\s\S]*?)```/g;
	let match;
	while ((match = regex.exec(reply)) !== null) {
		let filePath = match[1]?.trim();
		const fileContent = match[2];
		
		// Fallback check if file path is on the first line inside the block
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
			const absPath = path.join(target, filePath);
			fs.mkdirSync(path.dirname(absPath), { recursive: true });
			fs.writeFileSync(absPath, fileContent, 'utf8');
			modifiedFiles++;
		}
	}

	const { stdout: diff } = await execAsync('git diff', { cwd: target });
	const { stdout: status } = await execAsync('git status -s', { cwd: target });

	return {
		provider: 'DeepSeek R1 (14b GPU)',
		branch: branchName,
		status: status.trim() || 'Clean',
		diff: diff.trim() || (modifiedFiles > 0 ? `(${modifiedFiles} files created/modified - untracked)` : '(No files modified)'),
		logs: reply.trim(),
		tokens: {
			total_tokens: usage.total_tokens || 0,
			input_tokens: usage.prompt_tokens || 0,
			cached_input_tokens: 0,
			output_tokens: usage.completion_tokens || 0
		}
	};
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { workspace, prompt, branch, provider = 'codex' } = await request.json();
		if (!workspace || !prompt) {
			return json({ error: 'workspace and prompt required' }, { status: 400 });
		}

		const target = path.join(WORKSPACES_DIR, workspace);
		if (!fs.existsSync(target)) {
			return json({ error: 'Workspace not found' }, { status: 404 });
		}

		const timestamp = Date.now();

		if (provider === 'deepseek') {
			const taskBranch = branch?.trim() || `agent/deepseek-${timestamp}`;
			const result = await runDeepSeekTask(target, prompt, taskBranch);
			return json({ success: true, mode: 'single', ...result });
		}

		if (provider === 'both') {
			const codexBranch = `agent/codex-${timestamp}`;
			const deepseekBranch = `agent/deepseek-${timestamp}`;

			// Run in parallel or sequential
			const codexRes = await runCodexTask(target, prompt, codexBranch);
			const deepseekRes = await runDeepSeekTask(target, prompt, deepseekBranch);

			return json({
				success: true,
				mode: 'both',
				codex: codexRes,
				deepseek: deepseekRes
			});
		}

		// Default: Codex
		const taskBranch = branch?.trim() || `agent/codex-${timestamp}`;
		const result = await runCodexTask(target, prompt, taskBranch);
		return json({ success: true, mode: 'single', ...result });
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};