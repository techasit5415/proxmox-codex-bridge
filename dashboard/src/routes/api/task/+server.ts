import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = util.promisify(exec);
const WORKSPACES_DIR = '/opt/agent-bridge/workspaces';

function getLatestTokenUsage() {
	const baseDir = '/root/.codex/sessions';
	if (!fs.existsSync(baseDir)) return null;

	function getFiles(dir: string): string[] {
		let files: string[] = [];
		fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				files = files.concat(getFiles(fullPath));
			} else if (entry.name.endsWith('.jsonl')) {
				files.push(fullPath);
			}
		});
		return files;
	}

	const allFiles = getFiles(baseDir);
	if (allFiles.length === 0) return null;

	allFiles.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
	const latestFile = allFiles[0];

	const lines = fs.readFileSync(latestFile, 'utf8').split('\n');
	let lastUsage: any = null;
	for (const line of lines) {
		if (!line.trim()) continue;
		try {
			const parsed = JSON.parse(line);
			const payload = parsed.payload;
			if (payload?.info?.total_token_usage) {
				lastUsage = payload.info.total_token_usage;
			} else if (payload?.token_usage) {
				lastUsage = payload.token_usage;
			}
		} catch (e) {}
	}
	return lastUsage;
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { workspace, prompt, branch } = await request.json();
		if (!workspace || !prompt) {
			return json({ error: 'workspace and prompt required' }, { status: 400 });
		}

		const target = path.join(WORKSPACES_DIR, workspace);
		if (!fs.existsSync(target)) {
			return json({ error: 'Workspace not found' }, { status: 404 });
		}

		const taskBranch = branch?.trim() || `agent/task-${Date.now()}`;
		try {
			await execAsync(`git checkout -b ${taskBranch}`, { cwd: target });
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

		return json({
			success: true,
			branch: taskBranch,
			status: status.trim() || '(Clean)',
			diff: diff.trim() || '(No tracked files modified)',
			logs: (stdout + '\n' + stderr).trim(),
			tokens: tokens || { total_tokens: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 }
		});
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};