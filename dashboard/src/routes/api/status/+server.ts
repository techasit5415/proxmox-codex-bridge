import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import { getRedisClient, isRedisConnected, getActiveQueueJobs } from '$lib/queue';

const execAsync = util.promisify(exec);
const WORKSPACES_DIR = '/opt/agent-bridge/workspaces';

let cachedTokenStats: any = null;
let cachedTokenStatsAt = 0;
let cachedStaticVersions: { nodeVer: string; codexVer: string } | null = null;

function getSessionTokens() {
	const now = Date.now();
	if (cachedTokenStats && now - cachedTokenStatsAt < 10000) {
		return cachedTokenStats;
	}

	const baseDir = '/root/.codex/sessions';
	if (!fs.existsSync(baseDir)) {
		return {
			totalTokens: 0,
			netTokens: 0,
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
					const latTotal = lastUsage.total_tokens || 0;
					const latCached = lastUsage.cached_input_tokens || 0;
					latest = {
						workspace: workspace || 'unknown',
						...lastUsage,
						net_tokens: Math.max(0, latTotal - latCached)
					};
				}
			}
		} catch (e) {}
	}

	const netTokens = Math.max(0, totalTokens - cachedTokens);

	cachedTokenStats = {
		totalTokens,
		netTokens,
		inputTokens,
		cachedTokens,
		outputTokens,
		sessionCount,
		latest: latest || { total_tokens: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, net_tokens: 0 }
	};
	cachedTokenStatsAt = now;
	return cachedTokenStats;
}

export const GET: RequestHandler = async () => {
	try {
		const isAuthed = fs.existsSync('/root/.codex/auth.json');

		let diskUsage = 'N/A';
		let diskFree = 'N/A';
		let diskPercent = '';
		try {
			const targetDiskPath = fs.existsSync(WORKSPACES_DIR) ? WORKSPACES_DIR : '/';
			const { stdout: dfRaw } = await execAsync(`df -h "${targetDiskPath}" | awk 'NR==2 {print $3 "|" $2 "|" $4 "|" $5}'`, { timeout: 3000 });
			const parts = dfRaw.trim().split('|');
			if (parts.length >= 4) {
				const [diskUsed, diskTotal, freeVal, pctVal] = parts;
				diskFree = freeVal || 'N/A';
				diskPercent = pctVal || '';
				diskUsage = `${diskUsed} / ${diskTotal} (${diskPercent})`;
			}
		} catch (e) {}

		let memoryUsage = 'N/A';
		try {
			const { stdout: mem } = await execAsync("free -h | awk 'NR==2 {print $3 \" / \" $2}'", { timeout: 3000 });
			memoryUsage = mem.trim() || 'N/A';
		} catch (e) {}

		if (!cachedStaticVersions) {
			try {
				const { stdout: nodeVer } = await execAsync('node -v', { timeout: 3000 });
				const { stdout: codexVer } = await execAsync('codex --version 2>/dev/null || echo "codex-cli"', { timeout: 3000 });
				cachedStaticVersions = { nodeVer: nodeVer.trim(), codexVer: codexVer.trim() };
			} catch {
				cachedStaticVersions = { nodeVer: process.version, codexVer: 'codex-cli' };
			}
		}

		const tokens = getSessionTokens();

		let redisStatus = 'offline';
		let queueLength: number | null = null;
		let processingCount: number | null = null;
		let activeJobs: any[] = [];
		try {
			const connected = await isRedisConnected();
			if (connected) {
				redisStatus = 'online';
				const qInfo = await getActiveQueueJobs();
				queueLength = qInfo.queueLength;
				processingCount = qInfo.processingCount;
				activeJobs = qInfo.activeJobs;
			}
		} catch (e) {}

		return json({
			status: 'online',
			codexAuth: isAuthed ? 'ChatGPT Plus' : 'Not Connected',
			codexVersion: cachedStaticVersions.codexVer,
			nodeVersion: cachedStaticVersions.nodeVer,
			diskUsage,
			diskFree,
			diskPercent,
			memoryUsage,
			workspacesDir: WORKSPACES_DIR,
			redisStatus,
			queueLength,
			processingCount,
			activeJobs,
			tokens
		});
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};
