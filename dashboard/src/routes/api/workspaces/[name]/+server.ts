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
		
		const statusLines = status.trim().split('\n').filter(Boolean);
		const modifiedCount = statusLines.filter(l => l.startsWith(' M') || l.startsWith('M ')).length;
		const untrackedCount = statusLines.filter(l => l.startsWith('??')).length;
		
		const files = fs.readdirSync(target);

		return json({
			name: params.name,
			branch: branch.trim(),
			clean: statusLines.length === 0,
			statusSummary: statusLines.length === 0 ? 'Clean' : `${statusLines.length} changed`,
			modifiedCount,
			untrackedCount,
			rawStatus: status.trim() || 'Clean',
			recentCommits: recentLogs.trim().split('\n').filter(Boolean),
			files
		});
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	try {
		const wsName = path.basename(params.name);
		if (!wsName || wsName === '.' || wsName === '..') {
			return json({ error: 'Invalid workspace name' }, { status: 400 });
		}
		const target = path.join(WORKSPACES_DIR, wsName);
		if (!fs.existsSync(target)) {
			return json({ error: 'Workspace not found' }, { status: 404 });
		}
		fs.rmSync(target, { recursive: true, force: true });
		return json({ success: true, message: `Workspace '${wsName}' deleted` });
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};