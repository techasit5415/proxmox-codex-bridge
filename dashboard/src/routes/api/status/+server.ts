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

export const GET: RequestHandler = async () => {
	try {
		const isAuthed = fs.existsSync('/root/.codex/auth.json');
		const { stdout: df } = await execAsync("df -h / | awk 'NR==2 {print $3 \" / \" $2 \" (\" $5 \")\"}'");
		const { stdout: mem } = await execAsync("free -h | awk 'NR==2 {print $3 \" / \" $2}'");
		const { stdout: nodeVer } = await execAsync('node -v');
		const { stdout: codexVer } = await execAsync('codex --version 2>/dev/null || echo "codex-cli"');
		const tokens = getLatestTokenUsage();

		return json({
			status: 'online',
			codexAuth: isAuthed ? 'Logged in (ChatGPT Plus)' : 'Not Logged in',
			codexVersion: codexVer.trim(),
			nodeVersion: nodeVer.trim(),
			diskUsage: df.trim(),
			memoryUsage: mem.trim(),
			workspacesDir: WORKSPACES_DIR,
			tokens: tokens || { total_tokens: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 }
		});
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};