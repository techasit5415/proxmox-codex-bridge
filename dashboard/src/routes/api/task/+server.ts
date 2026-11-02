import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = util.promisify(exec);
const WORKSPACES_DIR = '/opt/agent-bridge/workspaces';

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

		return json({
			success: true,
			branch: taskBranch,
			status: status.trim() || '(Clean)',
			diff: diff.trim() || '(No tracked files modified)',
			logs: (stdout + '\n' + stderr).trim()
		});
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};