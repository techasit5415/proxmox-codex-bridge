import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = util.promisify(exec);
const WORKSPACES_DIR = '/opt/agent-bridge/workspaces';

function getSessionTokens() {
	const baseDir = '/root/.codex/sessions';
	if (!fs.existsSync(baseDir)) {
		return {
			totalTokens: 0,
			inputTokens: 0,
			cachedTokens: 0,
			outputTokens: 0,
			sessionCount: 0,
			latest: null
		};
	}

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
	let totalTokens = 0, inputTokens = 0, cachedTokens = 0, outputTokens = 0;
	let sessionCount = 0;
	let latest = null;

	allFiles.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

	for (const file of allFiles) {
		try {
			const lines = fs.readFileSync(file, 'utf8').split('\n');
			let lastUsage: any = null;
			let workspace = null;
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const d = JSON.parse(line);
					if (d.payload?.cwd) workspace = path.basename(d.payload.cwd);
					if (d.payload?.info?.total_token_usage) lastUsage = d.payload.info.total_token_usage;
					else if (d.payload?.token_usage) lastUsage = d.payload.token_usage;
				} catch (e) {}
			}
			if (lastUsage) {
				sessionCount++;
				totalTokens += (lastUsage.total_tokens || 0);
				inputTokens += (lastUsage.input_tokens || 0);
				cachedTokens += (lastUsage.cached_input_tokens || 0);
				outputTokens += (lastUsage.output_tokens || 0);
				if (!latest) {
					latest = {
						workspace: workspace || 'unknown',
						...lastUsage
					};
				}
			}
		} catch (e) {}
	}

	return {
		totalTokens,
		inputTokens,
		cachedTokens,
		outputTokens,
		sessionCount,
		latest: latest || { total_tokens: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 }
	};
}

export const GET: RequestHandler = async () => {
	try {
		const isAuthed = fs.existsSync('/root/.codex/auth.json');
		const { stdout: df } = await execAsync("df -h / | awk 'NR==2 {print $3 \" / \" $2 \" (\" $5 \")\"}'");
		const { stdout: mem } = await execAsync("free -h | awk 'NR==2 {print $3 \" / \" $2}'");
		const { stdout: nodeVer } = await execAsync('node -v');
		const { stdout: codexVer } = await execAsync('codex --version 2>/dev/null || echo "codex-cli"');
		const tokens = getSessionTokens();

		return json({
			status: 'online',
			codexAuth: isAuthed ? 'ChatGPT Plus' : 'Not Connected',
			codexVersion: codexVer.trim(),
			nodeVersion: nodeVer.trim(),
			diskUsage: df.trim(),
			memoryUsage: mem.trim(),
			workspacesDir: WORKSPACES_DIR,
			tokens
		});
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};