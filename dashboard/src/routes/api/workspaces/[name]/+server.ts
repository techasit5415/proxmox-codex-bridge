import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = util.promisify(exec);
const WORKSPACES_DIR = '/opt/agent-bridge/workspaces';

export const GET: RequestHandler = async ({ params }) => {
	try {
		const target = path.join(WORKSPACES_DIR, params.name);
		if (!fs.existsSync(target)) {
			return json({ error: 'Workspace not found' }, { status: 404 });
		}

		const { stdout: branch } = await execAsync('git branch --show-current 2>/dev/null || echo "none"', { cwd: target });
		const { stdout: status } = await execAsync('git status -s 2>/dev/null || echo ""', { cwd: target });
		const { stdout: recentLogs } = await execAsync('git log -n 5 --oneline 2>/dev/null || echo "No commits yet"', { cwd: target });
		const files = fs.readdirSync(target);

		return json({
			name: params.name,
			branch: branch.trim(),
			status: status.trim() || '(Clean)',
			recentCommits: recentLogs.trim().split('\n'),
			files
		});
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};