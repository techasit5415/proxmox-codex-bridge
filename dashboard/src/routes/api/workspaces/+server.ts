import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';

const execAsync = util.promisify(exec);
const WORKSPACES_DIR = '/opt/agent-bridge/workspaces';

export const GET: RequestHandler = async () => {
	try {
		if (!fs.existsSync(WORKSPACES_DIR)) {
			fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
		}
		const dirs = fs
			.readdirSync(WORKSPACES_DIR, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => d.name);

		return json({ workspaces: dirs });
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { repoUrl, folderName } = await request.json();
		if (!repoUrl) return json({ error: 'repoUrl is required' }, { status: 400 });

		const dest = folderName ? folderName.trim() : '';
		const cmd = `git clone ${repoUrl} ${dest}`;
		const { stdout, stderr } = await execAsync(cmd, { cwd: WORKSPACES_DIR, timeout: 60000 });

		return json({ success: true, message: 'Repo cloned successfully', logs: stdout + stderr });
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};