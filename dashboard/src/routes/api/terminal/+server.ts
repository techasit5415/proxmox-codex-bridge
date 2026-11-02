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
		const { workspace, command } = await request.json();
		if (!workspace || !command) {
			return json({ error: 'workspace and command required' }, { status: 400 });
		}

		const target = path.join(WORKSPACES_DIR, workspace);
		if (!fs.existsSync(target)) {
			return json({ error: 'Workspace not found' }, { status: 404 });
		}

		const { stdout, stderr } = await execAsync(command, {
			cwd: target,
			timeout: 5 * 60 * 1000,
			maxBuffer: 10 * 1024 * 1024
		});

		return json({ output: stdout + (stderr ? '\n[stderr]:\n' + stderr : '') });
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};