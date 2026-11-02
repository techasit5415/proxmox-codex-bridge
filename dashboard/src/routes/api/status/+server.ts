import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';

const execAsync = util.promisify(exec);
const WORKSPACES_DIR = '/opt/agent-bridge/workspaces';

export const GET: RequestHandler = async () => {
	try {
		const isAuthed = fs.existsSync('/root/.codex/auth.json');
		const { stdout: df } = await execAsync("df -h / | awk 'NR==2 {print $3 \" / \" $2 \" (\" $5 \")\"}'");
		const { stdout: mem } = await execAsync("free -h | awk 'NR==2 {print $3 \" / \" $2}'");
		const { stdout: nodeVer } = await execAsync('node -v');
		const { stdout: codexVer } = await execAsync('codex --version 2>/dev/null || echo "codex-cli"');

		return json({
			status: 'online',
			codexAuth: isAuthed ? 'Logged in (ChatGPT Plus)' : 'Not Logged in',
			codexVersion: codexVer.trim(),
			nodeVersion: nodeVer.trim(),
			diskUsage: df.trim(),
			memoryUsage: mem.trim(),
			workspacesDir: WORKSPACES_DIR
		});
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};