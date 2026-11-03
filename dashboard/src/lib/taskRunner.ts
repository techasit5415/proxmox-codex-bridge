import { exec, spawn } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import { saveTaskToHistory } from './history';
import { detectTaskType } from './types';
import type { AIModelConfig, TaskResult, TestEvidence, TaskJobData } from './types';
import { getModels } from './models';

const execAsync = util.promisify(exec);
export const WORKSPACES_DIR = '/opt/agent-bridge/workspaces';
const KMITL_API_URL = 'https://aipass.cskmitl.com/api/chat';
const KMITL_TOKEN = process.env.KMITL_TOKEN || '';
const DEEPSEEK_MODEL = 'deepseek-r1:14b';

/**
 * Validates and resolves a workspace name within WORKSPACES_DIR.
 * Prevents Directory Traversal, root access, and sibling prefix attacks.
 */
export function resolveSafeWorkspace(workspaceName: string): string {
	if (!workspaceName || typeof workspaceName !== 'string') {
		throw new Error('Workspace name is required');
	}
	const cleanName = workspaceName.trim();
	if (cleanName === '' || cleanName === '.' || cleanName === '..') {
		throw new Error('Invalid workspace name: cannot be root or dot directory');
	}
	if (cleanName.includes('/') || cleanName.includes('\\')) {
		throw new Error('Invalid workspace name: directory separators are forbidden');
	}

	const root = path.resolve(WORKSPACES_DIR);
	const target = path.resolve(root, cleanName);
	const rel = path.relative(root, target);

	if (
		rel === '' ||
		rel === '..' ||
		rel.startsWith(`..${path.sep}`) ||
		rel.startsWith('../') ||
		path.isAbsolute(rel)
	) {
		throw new Error('Forbidden workspace path: directory traversal detected');
	}

	// Symlink containment check: if path exists on disk, ensure canonical realpath is within root
	if (fs.existsSync(target)) {
		try {
			const realRoot = fs.realpathSync(root);
			const realTarget = fs.realpathSync(target);
			const realRel = path.relative(realRoot, realTarget);
			if (
				realRel === '' ||
				realRel === '..' ||
				realRel.startsWith(`..${path.sep}`) ||
				realRel.startsWith('../') ||
				path.isAbsolute(realRel)
			) {
				throw new Error('Forbidden workspace path: symlink escape detected');
			}
		} catch (err: any) {
			if (err.message.includes('Forbidden workspace path')) throw err;
			throw new Error(`Workspace path validation error: ${err.message}`);
		}
	}

	return target;
}

/**
 * Generates a sanitized environment object for child processes (Codex CLI, tests, git).
 * Prevents leaking host secrets, BRIDGE_API_KEY, SSH keys/agents, and API tokens to untrusted code.
 */
export function getSanitizedEnv(): NodeJS.ProcessEnv {
	// Strict allowlist: excludes SSH_AUTH_SOCK and CODEX_CONFIG_DIR
	const allowedKeys = [
		'PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TERM', 'SHELL', 'TMPDIR',
		'NODE_PATH', 'PYTHONPATH'
	];
	const safeEnv: NodeJS.ProcessEnv = {
		LANG: 'C.UTF-8',
		LC_ALL: 'C.UTF-8'
	};
	for (const key of allowedKeys) {
		if (process.env[key] !== undefined) {
			safeEnv[key] = process.env[key];
		}
	}
	return safeEnv;
}

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 10MB memory buffer limit

/**
 * Safely executes Codex CLI via direct stdin pipe without writing prompt files to /tmp,
 * without invoking a shell (shell: false), with process-tree termination and output buffering cap.
 */
export function execCodexWithStdin(
	runDir: string,
	prompt: string,
	timeoutMs = 15 * 60 * 1000
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			'codex',
			['exec', '--dangerously-bypass-approvals-and-sandbox', '-C', runDir, '-'],
			{
				cwd: runDir,
				env: getSanitizedEnv(),
				shell: false,
				detached: process.platform !== 'win32'
			}
		);

		let stdout = '';
		let stderr = '';
		let killed = false;
		let stdoutTruncated = false;
		let stderrTruncated = false;

		function killProcessGroup(signal: NodeJS.Signals) {
			if (!child.pid) return;
			try {
				if (process.platform !== 'win32') {
					process.kill(-child.pid, signal);
				} else {
					child.kill(signal);
				}
			} catch (e) {
				try { child.kill(signal); } catch (e2) {}
			}
		}

		const timer = setTimeout(() => {
			killed = true;
			killProcessGroup('SIGTERM');
			setTimeout(() => {
				if (!child.killed) killProcessGroup('SIGKILL');
			}, 3000);
			reject(new Error(`Codex process timed out after ${Math.round(timeoutMs / 1000)}s`));
		}, timeoutMs);

		child.stdout?.on('data', (d) => {
			if (stdout.length < MAX_OUTPUT_BYTES) {
				stdout += d.toString();
			} else if (!stdoutTruncated) {
				stdoutTruncated = true;
				stdout += '\n...[stdout truncated: exceeded 10MB limit]';
			}
		});

		child.stderr?.on('data', (d) => {
			if (stderr.length < MAX_OUTPUT_BYTES) {
				stderr += d.toString();
			} else if (!stderrTruncated) {
				stderrTruncated = true;
				stderr += '\n...[stderr truncated: exceeded 10MB limit]';
			}
		});

		child.on('error', (err) => {
			clearTimeout(timer);
			reject(err);
		});

		child.on('close', () => {
			clearTimeout(timer);
			if (killed) return;
			resolve({ stdout, stderr });
		});

		if (child.stdin) {
			child.stdin.on('error', () => {}); // Handle EPIPE cleanly
			child.stdin.write(prompt);
			child.stdin.end();
		}
	});
}

export function getLatestTokenUsage() {
	const baseDir = '/root/.codex/sessions';
	if (!fs.existsSync(baseDir)) return null;

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
	if (allFiles.length === 0) return null;
	allFiles.sort((a, b) => {
		try {
			return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
		} catch {
			return 0;
		}
	});
	const latestFile = allFiles[0];

	try {
		const lines = fs.readFileSync(latestFile, 'utf8').split('\n');
		let lastUsage: any = null;
		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const parsed = JSON.parse(line);
				const payload = parsed.payload;
				if (payload?.info?.total_token_usage) lastUsage = payload.info.total_token_usage;
				else if (payload?.token_usage) lastUsage = payload.token_usage;
			} catch (e) {}
		}
		if (lastUsage) {
			const total = lastUsage.total_tokens || 0;
			const cached = lastUsage.cached_input_tokens || 0;
			lastUsage.net_tokens = Math.max(0, total - cached);
		}
		return lastUsage;
	} catch (e) {
		return null;
	}
}

export interface WorktreeContext {
	worktreePath: string;
	branchName: string;
	baseCommit: string;
}

export function sanitizeForApi(text: string, maxChars = 4000): string {
	if (!text) return '';
	let clean = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
	                .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '');
	if (clean.length > maxChars) {
		clean = clean.slice(0, maxChars) + '\n...[truncated for token limit]';
	}
	return clean;
}

export async function prepareWorktree(repoDir: string, branchName: string, prefix: string): Promise<WorktreeContext> {
	try {
		await execAsync('git rev-parse HEAD', { cwd: repoDir });
	} catch (e) {
		await execAsync('git init && git add -A && git commit -m "init workspace" --allow-empty', { cwd: repoDir });
	}

	const { stdout: headOut } = await execAsync('git rev-parse HEAD', { cwd: repoDir });
	const baseCommit = headOut.trim();

	const excludeFile = path.join(repoDir, '.git', 'info', 'exclude');
	try {
		let excl = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : '';
		if (!excl.includes('.worktrees')) {
			fs.appendFileSync(excludeFile, '\n.worktrees\n.worktrees/**\n');
		}
	} catch (e) {}

	const worktreesBase = path.join(repoDir, '.worktrees');
	if (!fs.existsSync(worktreesBase)) {
		fs.mkdirSync(worktreesBase, { recursive: true });
	}

	const ts = Date.now();
	const rand = Math.random().toString(36).substring(2, 6);
	const worktreePath = path.join(worktreesBase, `${prefix}-${ts}-${rand}`);

	await execAsync(`git worktree add -B "${branchName}" "${worktreePath}" ${baseCommit}`, { cwd: repoDir });

	return { worktreePath, branchName, baseCommit };
}

export async function cleanupWorktree(repoDir: string, ctx: WorktreeContext, commitMsg?: string) {
	try {
		if (commitMsg && fs.existsSync(ctx.worktreePath)) {
			try {
				await execAsync(`git add -A && git commit -m "${commitMsg.replace(/"/g, '\\"')}" --allow-empty`, { cwd: ctx.worktreePath });
			} catch (e) {}
		}
	} catch (e) {}

	try {
		await execAsync(`git worktree remove --force "${ctx.worktreePath}"`, { cwd: repoDir });
	} catch (e) {
		try {
			if (fs.existsSync(ctx.worktreePath)) {
				fs.rmSync(ctx.worktreePath, { recursive: true, force: true });
			}
		} catch (err) {}
	}

	try {
		await execAsync('git worktree prune', { cwd: repoDir });
	} catch (e) {}
}

export async function runTestGate(targetDir: string): Promise<TestEvidence> {
	if (!fs.existsSync(targetDir)) {
		return { ran: false, passed: false, testCmd: 'none', output: 'Workspace does not exist', type: 'none' };
	}

	const safeEnv = getSanitizedEnv();

	try {
		// 1. package.json with test script
		const pkgPath = path.join(targetDir, 'package.json');
		if (fs.existsSync(pkgPath)) {
			try {
				const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
				if (pkg.scripts?.test && !pkg.scripts.test.includes('no test specified')) {
					const { stdout, stderr } = await execAsync('npm test', { cwd: targetDir, timeout: 45000, env: safeEnv });
					return {
						ran: true,
						passed: true,
						testCmd: 'npm test',
						type: 'test_suite',
						output: (stdout + '\n' + stderr).trim()
					};
				}
			} catch (err: any) {
				return {
					ran: true,
					passed: false,
					testCmd: 'npm test',
					type: 'test_suite',
					output: (err.stdout || '') + '\n' + (err.stderr || err.message),
					error: err.message
				};
			}
		}

		// 2. Python pytest or unittest
		const hasPytest = fs.existsSync(path.join(targetDir, 'pytest.ini')) ||
			fs.existsSync(path.join(targetDir, 'tests')) ||
			fs.existsSync(path.join(targetDir, 'test.py'));
		if (hasPytest) {
			try {
				const pyTestCmd = fs.existsSync(path.join(targetDir, 'tests'))
					? 'pytest -q 2>/dev/null || python3 -m unittest discover -s tests -p "test*.py"'
					: 'pytest -q 2>/dev/null || python3 -m unittest discover';
				const { stdout, stderr } = await execAsync(pyTestCmd, { cwd: targetDir, timeout: 45000, env: safeEnv });
				return {
					ran: true,
					passed: true,
					testCmd: 'pytest / python3 -m unittest',
					type: 'test_suite',
					output: (stdout + '\n' + stderr).trim()
				};
			} catch (err: any) {
				return {
					ran: true,
					passed: false,
					testCmd: 'pytest / python3 -m unittest',
					type: 'test_suite',
					output: (err.stdout || '') + '\n' + (err.stderr || err.message),
					error: err.message
				};
			}
		}

		// 3. Fallback: Syntax / Lint verification on modified files
		let diffFiles = '';
		try {
			const res = await execAsync('git diff --name-only HEAD~1 2>/dev/null || git status -s', { cwd: targetDir, env: safeEnv });
			diffFiles = res.stdout;
		} catch (e) {}

		const files = diffFiles.split('\n').map(f => f.trim().replace(/^..\s+/, '')).filter(Boolean);
		const jsTsFiles = files.filter(f => f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.cjs'));
		const pyFiles = files.filter(f => f.endsWith('.py'));

		const checkOutputs: string[] = [];
		let checkPassed = true;

		for (const f of jsTsFiles.slice(0, 10)) {
			const absF = path.join(targetDir, f);
			if (fs.existsSync(absF)) {
				try {
					await execAsync(`node --check "${absF}"`, { timeout: 10000, env: safeEnv });
					checkOutputs.push(`✔ Syntax OK: ${f}`);
				} catch (e: any) {
					checkPassed = false;
					checkOutputs.push(`✖ Syntax Error: ${f}\n${e.stderr || e.message}`);
				}
			}
		}

		for (const f of pyFiles.slice(0, 10)) {
			const absF = path.join(targetDir, f);
			if (fs.existsSync(absF)) {
				try {
					await execAsync(`python3 -m py_compile "${absF}"`, { timeout: 10000, env: safeEnv });
					checkOutputs.push(`✔ Syntax OK: ${f}`);
				} catch (e: any) {
					checkPassed = false;
					checkOutputs.push(`✖ Syntax Error: ${f}\n${e.stderr || e.message}`);
				}
			}
		}

		if (checkOutputs.length > 0) {
			return {
				ran: true,
				passed: checkPassed,
				testCmd: 'Automated Syntax Verification',
				type: 'syntax_check',
				output: checkOutputs.join('\n')
			};
		}

		return {
			ran: false,
			passed: true,
			testCmd: 'none',
			type: 'none',
			output: 'No test suite or script detected; workspace clean.'
		};
	} catch (e: any) {
		return {
			ran: false,
			passed: false,
			testCmd: 'error',
			type: 'none',
			output: e.message,
			error: e.message
		};
	}
}

/**
 * SSRF Guard: validates that a URL is a public http/https URL and does not target
 * loopback, RFC1918 private networks, link-local, or internal metadata endpoints.
 */
export function isSafePublicUrl(urlStr: string): boolean {
	try {
		const u = new URL(urlStr);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
		const host = u.hostname.toLowerCase();
		if (
			host === 'localhost' ||
			host === '127.0.0.1' ||
			host === '0.0.0.0' ||
			host === '::1' ||
			host.endsWith('.local') ||
			host.endsWith('.internal') ||
			host.endsWith('.localhost') ||
			host.startsWith('10.') ||
			host.startsWith('192.168.') ||
			host.startsWith('169.254.') ||
			/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
		) {
			return false;
		}
		return true;
	} catch {
		return false;
	}
}

/**
 * Extracts a GitHub repository URL from prompt text if present.
 */
export function extractGitHubRepoUrl(prompt: string): { cloneUrl: string; repoFullName: string } | null {
	if (!prompt) return null;
	const match = prompt.match(/https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git|\/|\s|$|[)>\]"',;])/i);
	if (!match) return null;
	const owner = match[1];
	const repo = match[2].replace(/\.git$/i, '');
	if (!owner || !repo) return null;
	return {
		cloneUrl: `https://github.com/${owner}/${repo}.git`,
		repoFullName: `${owner}/${repo}`
	};
}

/**
 * Checks whether a workspace directory is just an empty or auto-generated scratch workspace.
 */
export function isScratchWorkspace(dir: string): boolean {
	if (!fs.existsSync(dir)) return true;
	try {
		const entries = fs.readdirSync(dir).filter(e => e !== '.git' && e !== '.worktrees');
		if (entries.length === 0) return true;
		if (entries.length === 1 && entries[0] === 'README.md') {
			const content = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
			if (content.includes('Automated scratch workspace created for prompt')) {
				return true;
			}
		}
		return false;
	} catch {
		return false;
	}
}

/**
 * Automatically clones a GitHub repository referenced in the prompt into the workspace
 * if the workspace is currently an empty/auto-temp scratch workspace.
 * This allows both DeepSeek R1 and OpenAI Codex to inspect the exact same repository files locally.
 */
export async function autoCloneGitHubRepoIfNeeded(
	target: string,
	prompt: string,
	onEvent?: (event: Record<string, any>) => Promise<void>
): Promise<{ cloned: boolean; repoFullName?: string; cloneUrl?: string }> {
	const gh = extractGitHubRepoUrl(prompt);
	if (!gh) return { cloned: false };
	if (!isScratchWorkspace(target)) {
		return { cloned: true, repoFullName: gh.repoFullName, cloneUrl: gh.cloneUrl };
	}

	if (onEvent) {
		await onEvent({ type: 'stage', stage: `🌐 Auto-Fetching GitHub Repo (${gh.repoFullName})...` });
	}

	const tmpClone = `/tmp/bridge-autoclone-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
	try {
		await execAsync(`git clone --depth 1 "${gh.cloneUrl}" "${tmpClone}"`, {
			timeout: 60000,
			env: getSanitizedEnv()
		});
		// Clear scratch placeholder files in target and move cloned repo in
		for (const entry of fs.readdirSync(target)) {
			fs.rmSync(path.join(target, entry), { recursive: true, force: true });
		}
		await execAsync(`cp -a "${tmpClone}/." "${target}/"`, { timeout: 30000, env: getSanitizedEnv() });
		return { cloned: true, repoFullName: gh.repoFullName, cloneUrl: gh.cloneUrl };
	} catch (e: any) {
		console.error(`[Auto-PreFetcher] Failed to clone ${gh.cloneUrl}:`, e.message);
		return { cloned: false };
	} finally {
		try {
			if (fs.existsSync(tmpClone)) fs.rmSync(tmpClone, { recursive: true, force: true });
		} catch {}
	}
}

/**
 * Fetches clean readable text/markdown from a public web URL.
 * Uses Jina Reader (r.jina.ai) for clean Markdown extraction with direct HTML fallback.
 */
export async function fetchWebPageText(url: string, maxChars = 5500): Promise<string> {
	if (!isSafePublicUrl(url)) {
		return `[Blocked URL: ${url} is not a valid public HTTP/HTTPS address]`;
	}

	// 1. Try Jina Reader for clean Markdown
	try {
		const res = await fetch(`https://r.jina.ai/${url}`, {
			headers: { 'User-Agent': 'ProxmoxCodexBridge/2.3', 'X-Return-Format': 'markdown' },
			signal: AbortSignal.timeout(12000)
		});
		if (res.ok) {
			const text = await res.text();
			if (text && text.trim().length > 80) {
				return sanitizeForApi(text.trim(), maxChars);
			}
		}
	} catch {}

	// 2. Fallback: direct HTTP fetch + HTML tag stripping
	try {
		const res = await fetch(url, {
			headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) ProxmoxBridge/2.3' },
			signal: AbortSignal.timeout(10000)
		});
		if (!res.ok) {
			return `[HTTP ${res.status} fetching ${url}]`;
		}
		const html = await res.text();
		const stripped = html
			.replace(/<script[\s\S]*?<\/script>/gi, ' ')
			.replace(/<style[\s\S]*?<\/style>/gi, ' ')
			.replace(/<[^>]+>/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		return sanitizeForApi(stripped, maxChars);
	} catch (e: any) {
		return `[Error fetching ${url}: ${e.message}]`;
	}
}

/**
 * Performs a live web search via DuckDuckGo Lite and returns top results with titles, URLs, and snippets.
 */
export async function searchWebDuckDuckGo(query: string, maxResults = 6): Promise<string> {
	if (!query || !query.trim()) return '(Empty search query)';
	try {
		const res = await fetch('https://lite.duckduckgo.com/lite/', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0'
			},
			body: 'q=' + encodeURIComponent(query.trim()),
			signal: AbortSignal.timeout(12000)
		});
		if (!res.ok) return `[Web Search Error: HTTP ${res.status}]`;
		const html = await res.text();
		const strip = (s: string) =>
			s
				.replace(/<[^>]+>/g, '')
				.replace(/&amp;/g, '&')
				.replace(/&quot;/g, '"')
				.replace(/&#x27;/g, "'")
				.replace(/&lt;/g, '<')
				.replace(/&gt;/g, '>')
				.replace(/\s+/g, ' ')
				.trim();

		const results: string[] = [];
		const regex = /<a[^>]+href=["']([^"']+)["'][^>]+class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>[\s\S]*?<td[^>]+class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;
		let m;
		while ((m = regex.exec(html)) !== null && results.length < maxResults) {
			const href = m[1];
			const title = strip(m[2]);
			const snippet = strip(m[3]);
			if (title && href) {
				results.push(`${results.length + 1}. **${title}**\n   URL: ${href}\n   Snippet: ${snippet}`);
			}
		}
		if (results.length === 0) {
			return `No web search results found for "${query}".`;
		}
		return `Web Search Results for "${query}":\n\n` + results.join('\n\n');
	} catch (e: any) {
		return `[Web Search Error: ${e.message}]`;
	}
}

/**
 * Pre-fetches non-cloned web URLs found in the user prompt so DeepSeek can read external pages directly.
 */
export async function prefetchPromptWebUrls(
	prompt: string,
	clonedRepoFullName?: string,
	onEvent?: (event: Record<string, any>) => Promise<void>
): Promise<string> {
	if (!prompt) return '';
	const matches = prompt.match(/https?:\/\/[^\s)>\]"',;]+/gi) || [];
	const uniqueUrls = [...new Set(matches.map(u => u.replace(/[.,;!?]+$/, '')))];

	const toFetch = uniqueUrls.filter(u => {
		if (!isSafePublicUrl(u)) return false;
		// Skip the GitHub repo root URL if it was already cloned into the workspace
		if (clonedRepoFullName && u.toLowerCase().includes(clonedRepoFullName.toLowerCase())) {
			const afterRepo = u.split(new RegExp(clonedRepoFullName, 'i'))[1] || '';
			if (afterRepo === '' || afterRepo === '/' || afterRepo.toLowerCase() === '.git') {
				return false;
			}
		}
		return true;
	}).slice(0, 2);

	if (toFetch.length === 0) return '';

	if (onEvent) {
		await onEvent({ type: 'stage', stage: `🌐 Auto-Fetching ${toFetch.length} Web URL(s) for DeepSeek...` });
	}

	const sections: string[] = [];
	for (const url of toFetch) {
		const content = await fetchWebPageText(url, 4500);
		sections.push(`--- URL: ${url} ---\n${content}`);
	}
	return sections.join('\n\n');
}

/**
 * Safely reads a file inside runDir for DeepSeek's [TOOL:READ_FILE] agent capability.
 * Enforces path containment and realpath symlink checks.
 */
export function safeReadWorkspaceFile(runDir: string, relFilePath: string, maxChars = 4500): string {
	const rawInput = typeof relFilePath === 'string' ? relFilePath : '';
	const cleanRel = rawInput.trim().replace(/^['"`]+|['"`]+$/g, '').replace(/^\/+/, '') || '.';
	const root = path.resolve(runDir);
	const target = path.resolve(root, cleanRel);
	const rel = path.relative(root, target);

	if (rel === '..' || rel.startsWith(`..${path.sep}`) || rel.startsWith('../') || path.isAbsolute(rel)) {
		return `[Error: Access denied — path '${cleanRel}' is outside workspace]`;
	}
	if (!fs.existsSync(target)) {
		return `[Error: File '${cleanRel}' does not exist in workspace]`;
	}
	try {
		const realRoot = fs.realpathSync(root);
		const realTarget = fs.realpathSync(target);
		const realRel = path.relative(realRoot, realTarget);
		if (realRel === '..' || realRel.startsWith(`..${path.sep}`) || realRel.startsWith('../') || path.isAbsolute(realRel)) {
			return `[Error: Access denied — symlink escape detected for '${cleanRel}']`;
		}
		const stat = fs.statSync(realTarget);
		if (stat.isDirectory()) {
			const entries = fs.readdirSync(realTarget).filter(e => e !== '.git' && e !== '.worktrees').slice(0, 60);
			return `Directory '${cleanRel}' contents:\n` + entries.join('\n');
		}
		const content = fs.readFileSync(realTarget, 'utf8');
		return sanitizeForApi(content, maxChars);
	} catch (e: any) {
		return `[Error reading '${cleanRel}': ${e.message}]`;
	}
}

/**
 * Builds a rich Workspace Context Snapshot (file tree + README.md + key manifest & code files)
 * so DeepSeek R1 immediately sees real repository contents without guessing.
 */
export async function buildWorkspaceSnapshot(runDir: string, maxTotalChars = 10000): Promise<string> {
	let fileList: string[] = [];
	try {
		const { stdout } = await execAsync('git ls-files', { cwd: runDir, env: getSanitizedEnv() });
		fileList = stdout.split('\n').map(f => f.trim()).filter(Boolean);
	} catch {
		try {
			fileList = fs.readdirSync(runDir).filter(f => !f.startsWith('.'));
		} catch {}
	}

	if (fileList.length === 0) return '(Empty workspace)';

	const parts: string[] = [];
	parts.push(`=== WORKSPACE FILE TREE (${fileList.length} files) ===\n${fileList.slice(0, 100).join('\n')}`);
	let usedChars = parts[0].length;

	// Priority files to automatically include in context snapshot
	const priorityNames = [
		'README.md', 'readme.md', 'README.txt',
		'package.json', 'requirements.txt', 'pyproject.toml', 'Cargo.toml', 'go.mod',
		'Dockerfile', 'docker-compose.yml', 'config.py', 'app.py', 'main.py',
		'src/index.ts', 'src/main.ts', 'src/app.ts', 'server.ts', 'server.mjs'
	];

	const selectedFiles: string[] = [];
	for (const pName of priorityNames) {
		if (fileList.includes(pName) && !selectedFiles.includes(pName)) {
			selectedFiles.push(pName);
		}
	}

	// Also pick up to 5 key source files (e.g. in services/, src/, app/)
	for (const f of fileList) {
		if (selectedFiles.length >= 9) break;
		if (selectedFiles.includes(f)) continue;
		if (
			/\.(py|ts|js|svelte|go|rs|java|kt)$/i.test(f) &&
			!f.includes('test') &&
			!f.includes('node_modules') &&
			!f.endsWith('.min.js')
		) {
			selectedFiles.push(f);
		}
	}

	for (const relPath of selectedFiles) {
		if (usedChars >= maxTotalChars) break;
		const fullPath = path.join(runDir, relPath);
		try {
			if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) continue;
			const raw = fs.readFileSync(fullPath, 'utf8');
			// Skip auto-generated scratch README placeholder
			if (relPath.toLowerCase() === 'readme.md' && raw.includes('Automated scratch workspace created for prompt:')) {
				continue;
			}
			const budget = Math.min(3000, maxTotalChars - usedChars);
			if (budget < 200) break;
			const snippet = sanitizeForApi(raw, budget);
			const block = `\n--- FILE: ${relPath} ---\n${snippet}`;
			parts.push(block);
			usedChars += block.length;
		} catch {}
	}

	return parts.join('\n');
}

/**
 * Unified Streaming KMITL DeepSeek API Client.
 * Always uses `stream: true` (prevents Nginx 504 Gateway Time-out during long <think> blocks)
 * and `options: { num_ctx: 16384 }` (prevents HTTP 400 context window 4096 overflow).
 */
export async function callKmitlDeepSeekStream(
	messages: Array<{ role: string; content: string }>,
	numCtx = 16384
): Promise<{
	thinking: string;
	reply: string;
	promptTokens: number;
	completionTokens: number;
	cachedTokens: number;
}> {
	const res = await fetch(KMITL_API_URL, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${KMITL_TOKEN}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model: DEEPSEEK_MODEL,
			messages,
			options: { num_ctx: numCtx },
			stream: true
		})
	});

	if (!res.ok) {
		const errText = await res.text().catch(() => '');
		throw new Error(`KMITL API Error (${res.status}): ${errText}`);
	}

	const reader = res.body?.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let thinking = '';
	let reply = '';
	let promptTokens = 0;
	let completionTokens = 0;
	let cachedTokens = 0;

	if (reader) {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const json = JSON.parse(line);
					if (json.message?.thinking) thinking += json.message.thinking;
					if (json.message?.content) reply += json.message.content;
					if (json.prompt_eval_count) promptTokens = json.prompt_eval_count;
					if (json.eval_count) completionTokens = json.eval_count;
					if (json.prompt_eval_cached_count) cachedTokens = json.prompt_eval_cached_count;
				} catch {}
			}
		}
	}

	return { thinking, reply, promptTokens, completionTokens, cachedTokens };
}

export async function runCodexTask(
	target: string,
	prompt: string,
	branchName: string,
	cwdOverride?: string,
	hasClonedRepo = false
): Promise<TaskResult> {
	const runDir = cwdOverride || target;
	if (!cwdOverride) {
		try {
			await execAsync(`git checkout -b ${branchName}`, { cwd: target });
		} catch (e) {}
	}

	const taskType = detectTaskType(prompt);
	const repoAvailable = hasClonedRepo || !isScratchWorkspace(runDir);

	let effectivePrompt = prompt;
	if (taskType === 'general') {
		if (repoAvailable) {
			effectivePrompt = `[TASK TYPE: REPOSITORY ANALYSIS / ADVISORY CONSULTATION]
Note: The target repository is ALREADY cloned directly in your current working directory (${runDir}).
TOKEN-SAVING RULES:
1. Do NOT run \`git clone\` into /tmp — the files are already right here in ${runDir}.
2. Read files selectively (e.g. README.md and key modules) without dumping entire huge files into stdout unnecessarily.
3. Do NOT modify or create any files unless the user explicitly asked to edit files. Respond comprehensively in the requested language (e.g. Thai).

User Question:
${prompt}`;
		} else {
			effectivePrompt = `[TASK TYPE: GENERAL CONSULTATION / ADVISORY / PLANNING]
Note: This is a general query, planning, or advisory question (NOT a file-editing code task).
Please respond directly, thoroughly, and comprehensively to the user's question in the requested language (e.g. Thai).
Do NOT attempt to search workspace files with rg/find or edit files unless explicitly instructed.

User Question:
${prompt}`;
		}
	} else if (repoAvailable) {
		effectivePrompt = `[Workspace Note: The target repository files are already present in your working directory (${runDir}). Do NOT clone into /tmp.]\n\n${prompt}`;
	}

	let stdout = '';
	let stderr = '';
	const res = await execCodexWithStdin(runDir, effectivePrompt, 15 * 60 * 1000);
	stdout = res.stdout;
	stderr = res.stderr;
	const { stdout: diff } = await execAsync('git diff', { cwd: runDir });
	const { stdout: status } = await execAsync('git status -s', { cwd: runDir });
	const tokens = getLatestTokenUsage();

	return {
		provider: 'Codex (gpt-6.1-sol)',
		branch: branchName,
		status: status.trim() || 'Clean',
		diff: diff.trim() || '(No tracked files modified)',
		logs: (stdout + '\n' + stderr).trim(),
		tokens: tokens || { total_tokens: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, net_tokens: 0 }
	};
}

export async function runDeepSeekTask(
	target: string,
	prompt: string,
	branchName: string,
	cwdOverride?: string,
	preFetchedWebContext = '',
	onEvent?: (event: Record<string, any>) => Promise<void>
): Promise<TaskResult> {
	const runDir = cwdOverride || target;
	if (!cwdOverride) {
		try {
			await execAsync(`git checkout -b ${branchName}`, { cwd: target });
		} catch (e) {}
	}

	const taskType = detectTaskType(prompt);
	const workspaceSnapshot = await buildWorkspaceSnapshot(runDir, 10000);

	const toolInstructions = `
=== AGENTIC TOOLS AVAILABLE (EXECUTED BY PROXMOX BRIDGE) ===
You have live access to the workspace files and the internet via the Proxmox Bridge!
If the provided Workspace Snapshot or Pre-Fetched Web Content below is not enough and you need to inspect additional files or search the internet before answering, output one or more tool commands on their own line:
- To read a specific file in the workspace:
  [TOOL:READ_FILE] path/to/file.ext
- To list files in a subdirectory:
  [TOOL:LIST_FILES] path/to/dir
- To search the internet (DuckDuckGo):
  [TOOL:WEB_SEARCH] your search query
- To fetch a specific web page URL:
  [TOOL:FETCH_URL] https://example.com/page

If you already have enough information in the Workspace Snapshot and Pre-Fetched Web Content below, answer the user's request directly and thoroughly without outputting [TOOL:...] lines.`;

	const systemPrompt = taskType === 'general'
		? `You are an expert AI Software Architect, Advisor, and Analyst running on the Proxmox Multi-Agent Bridge.
Provide a clear, accurate, evidence-based, and comprehensive response in the requested language (e.g. Thai).
Base your analysis strictly on the real Workspace Snapshot, Pre-Fetched Web Content, and any Tool results. Never guess or hallucinate repository contents.
Do NOT output file: blocks or modify files unless explicitly asked to write files.
${toolInstructions}`
		: `You are an expert software engineer running on the Proxmox Multi-Agent Bridge. Given a user task and workspace files, generate the necessary code changes.
For each file you create or modify, format your response strictly using this syntax:

file:path/to/file.ext
\`\`\`language
<complete file content here>
\`\`\`

Do not output git diff markers directly, just output the complete file contents inside the file: block.
${toolInstructions}`;

	const contextSections: string[] = [];
	if (workspaceSnapshot && workspaceSnapshot !== '(Empty workspace)') {
		contextSections.push(workspaceSnapshot);
	}
	if (preFetchedWebContext) {
		contextSections.push(`=== PRE-FETCHED WEB CONTENT ===\n${preFetchedWebContext}`);
	}
	contextSections.push(`=== USER TASK / QUESTION ===\n${prompt}`);

	const messages: Array<{ role: string; content: string }> = [
		{ role: 'system', content: systemPrompt },
		{ role: 'user', content: contextSections.join('\n\n') }
	];

	const MAX_AGENT_TURNS = 3;
	let allThinking: string[] = [];
	let finalReply = '';
	let totalPromptTokens = 0;
	let totalCompletionTokens = 0;
	let totalCachedTokens = 0;

	for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
		const step = await callKmitlDeepSeekStream(messages, 16384);
		if (step.thinking) {
			allThinking.push(turn === 0 ? step.thinking : `[Turn ${turn + 1} Thinking]\n${step.thinking}`);
		}
		totalPromptTokens += step.promptTokens || 35;
		totalCompletionTokens += step.completionTokens || 0;
		totalCachedTokens += step.cachedTokens || 0;
		finalReply = step.reply;

		// Check if DeepSeek invoked any [TOOL:...] commands
		const toolRegex = /\[TOOL:(READ_FILE|LIST_FILES|WEB_SEARCH|FETCH_URL)\][ \t]*([^\r\n]*)/gi;
		const toolCalls: Array<{ type: string; arg: string }> = [];
		let tMatch;
		while ((tMatch = toolRegex.exec(step.reply)) !== null && toolCalls.length < 4) {
			const tType = tMatch[1].toUpperCase();
			const tArg = (tMatch[2] || '').trim();
			if (tType !== 'LIST_FILES' && !tArg) continue;
			toolCalls.push({ type: tType, arg: tArg || '.' });
		}

		// If no tool calls or last turn, we are done!
		if (toolCalls.length === 0 || turn === MAX_AGENT_TURNS - 1) {
			break;
		}

		// Execute requested tools on Proxmox CT
		const toolResults: string[] = [];
		for (const tc of toolCalls) {
			if (onEvent) {
				await onEvent({ type: 'stage', stage: `🔍 DeepSeek Agent Tool: ${tc.type} (${tc.arg.slice(0, 45)})...` });
			}
			let resText = '';
			if (tc.type === 'READ_FILE') {
				resText = safeReadWorkspaceFile(runDir, tc.arg, 4500);
			} else if (tc.type === 'LIST_FILES') {
				resText = safeReadWorkspaceFile(runDir, tc.arg || '.', 3000);
			} else if (tc.type === 'WEB_SEARCH') {
				resText = await searchWebDuckDuckGo(tc.arg, 5);
			} else if (tc.type === 'FETCH_URL') {
				resText = await fetchWebPageText(tc.arg, 4500);
			}
			toolResults.push(`=== RESULT OF [TOOL:${tc.type}] ${tc.arg} ===\n${resText}`);
			allThinking.push(`🔧 [Executed Tool: ${tc.type} "${tc.arg}"] (${resText.length} chars returned)`);
		}

		messages.push({ role: 'assistant', content: step.reply });
		messages.push({
			role: 'user',
			content: `${toolResults.join('\n\n')}\n\nNow provide your complete, final response to the user's original task in the requested language (e.g. Thai) based on all gathered evidence. Do NOT output further [TOOL:...] commands.`
		});
	}

	const combinedThinking = allThinking.join('\n\n');
	const fullLogs = combinedThinking ? `<think>\n${combinedThinking}\n</think>\n\n${finalReply}` : finalReply;
	const totalTokens = totalPromptTokens + totalCompletionTokens;
	const netTokens = Math.max(0, totalTokens - totalCachedTokens);

	// Only parse file blocks and write to disk if this is a code modification task (or explicit file: prefix)
	let modifiedFiles = 0;
	if (taskType === 'code') {
		const regex = /(?:file:([^\n\r]+)[\r\n]+)?```[a-zA-Z0-9_\-]*[\r\n]+([\s\S]*?)```/g;
		let match;
		while ((match = regex.exec(finalReply)) !== null) {
			let filePath = match[1]?.trim();
			const fileContent = match[2];

			if (!filePath) {
				const firstLine = fileContent.trim().split('\n')[0];
				if (firstLine.startsWith('//') || firstLine.startsWith('#')) {
					const candidate = firstLine.replace(/^(\/\/|#)\s*/, '').trim();
					if (candidate.includes('.') && !candidate.includes(' ')) {
						filePath = candidate;
					}
				}
			}

			if (filePath) {
				const root = path.resolve(runDir);
				const absPath = path.resolve(root, filePath.replace(/^\/+/, ''));
				const rel = path.relative(root, absPath);
				if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
					fs.mkdirSync(path.dirname(absPath), { recursive: true });
					fs.writeFileSync(absPath, fileContent, 'utf8');
					modifiedFiles++;
				}
			}
		}
	}

	const { stdout: diff } = await execAsync('git diff', { cwd: runDir });
	const { stdout: status } = await execAsync('git status -s', { cwd: runDir });

	return {
		provider: 'DeepSeek R1 (14b GPU)',
		branch: branchName,
		status: status.trim() || 'Clean',
		diff: diff.trim() || (modifiedFiles > 0 ? `(${modifiedFiles} files created/modified - untracked)` : '(No files modified)'),
		logs: fullLogs.trim(),
		tokens: {
			total_tokens: totalTokens,
			input_tokens: totalPromptTokens,
			cached_input_tokens: totalCachedTokens,
			output_tokens: totalCompletionTokens,
			net_tokens: netTokens
		}
	};
}

export async function runCustomModelTask(
	modelConfig: AIModelConfig,
	target: string,
	prompt: string,
	branch: string
): Promise<TaskResult> {
	const taskType = detectTaskType(prompt);
	let fileList = '';
	try {
		const { stdout } = await execAsync('git ls-files', { cwd: target });
		fileList = stdout.trim().split('\n').slice(0, 50).join('\n');
	} catch (e) {}

	const systemPrompt = taskType === 'general'
		? `You are an expert AI assistant and advisor. Provide a clear, detailed, and structured response in the requested language (e.g. Thai).`
		: `You are an expert software engineer. Given a user task and workspace files, generate the necessary code changes.
For each file you create or modify, format your response strictly using this syntax:
file:path/to/file.ext
\`\`\`language
<complete file content here>
\`\`\`
Do not output git diff markers directly, just output the complete file contents inside the file: block.`;

	const userContent = taskType === 'general'
		? prompt
		: `Workspace files:\n${fileList}\n\nTask:\n${prompt}`;

	let reply = '';
	let thinking = '';
	let totalTokens = 0;

	if (modelConfig.type === 'anthropic') {
		const res = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'x-api-key': modelConfig.apiKey || '',
				'anthropic-version': '2023-06-01',
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				model: modelConfig.modelId || 'claude-3-5-sonnet-20241022',
				max_tokens: 4096,
				system: systemPrompt,
				messages: [{ role: 'user', content: userContent }]
			})
		});
		if (!res.ok) {
			const errText = await res.text().catch(() => '');
			throw new Error(`Anthropic API Error (${res.status}): ${errText}`);
		}
		const data = await res.json();
		for (const block of data.content || []) {
			if (block.type === 'text') reply += block.text;
			if (block.type === 'thinking') thinking += block.thinking;
		}
		totalTokens = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
	} else if (modelConfig.type === 'openai-compatible') {
		const endpoint = modelConfig.endpoint || 'https://api.openai.com/v1/chat/completions';
		const res = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${modelConfig.apiKey || ''}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: modelConfig.modelId || 'gpt-4o',
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userContent }
				]
			})
		});
		if (!res.ok) {
			const errText = await res.text().catch(() => '');
			throw new Error(`API Error (${res.status}): ${errText}`);
		}
		const data = await res.json();
		reply = data.choices?.[0]?.message?.content || '';
		totalTokens = data.usage?.total_tokens || 0;
	} else if (modelConfig.type === 'ollama') {
		const endpoint = modelConfig.endpoint || 'http://localhost:11434/api/chat';
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (modelConfig.apiKey) headers['Authorization'] = `Bearer ${modelConfig.apiKey}`;
		const res = await fetch(endpoint, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				model: modelConfig.modelId,
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userContent }
				],
				stream: false
			})
		});
		if (!res.ok) {
			const errText = await res.text().catch(() => '');
			throw new Error(`Ollama Error (${res.status}): ${errText}`);
		}
		const data = await res.json();
		reply = data.message?.content || '';
		if (data.message?.thinking) thinking = data.message.thinking;
		totalTokens = (data.prompt_eval_count || 0) + (data.eval_count || 0);
	}

	let diff = '';
	if (taskType === 'code') {
		const fileRegex = /file:([^\n]+)\s*```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g;
		let match;
		const writtenFiles: string[] = [];
		while ((match = fileRegex.exec(reply)) !== null) {
			const filePath = match[1].trim();
			const fileContent = match[2];
			const fullPath = path.join(target, filePath);
			fs.mkdirSync(path.dirname(fullPath), { recursive: true });
			fs.writeFileSync(fullPath, fileContent, 'utf8');
			writtenFiles.push(filePath);
		}
		if (writtenFiles.length > 0) {
			try {
				await execAsync(`git checkout -b ${branch}`, { cwd: target });
			} catch (e) {}
			await execAsync('git add -A', { cwd: target });
			await execAsync(`git commit -m "${modelConfig.name}: ${prompt.slice(0, 50)}"`, { cwd: target });
			const { stdout: diffOut } = await execAsync('git diff HEAD~1 HEAD', { cwd: target });
			diff = diffOut;
		}
	}

	const thinkSection = thinking ? `<think>\n${thinking}\n</think>\n\n` : '';
	return {
		provider: modelConfig.name,
		branch,
		status: 'Success',
		diff,
		logs: (thinkSection + reply).trim(),
		tokens: {
			total_tokens: totalTokens,
			input_tokens: 0,
			cached_input_tokens: 0,
			output_tokens: totalTokens
		}
	};
}

function slugifyPrompt(prompt: string): string {
	const clean = (prompt || '')
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 35);
	const id = Math.random().toString(36).substring(2, 6);
	return `temp-${clean || 'scratch'}-${id}`;
}

export async function executeTaskPipeline(
	job: TaskJobData,
	onEvent?: (event: Record<string, any>) => Promise<void>
): Promise<any> {
	const { prompt, branch, provider = 'codex' } = job;
	let activeWorkspace = job.workspace?.trim();
	let target: string;

	if (!activeWorkspace || activeWorkspace === 'auto-temp' || activeWorkspace === 'temp') {
		activeWorkspace = slugifyPrompt(prompt);
		job.workspace = activeWorkspace;
		target = resolveSafeWorkspace(activeWorkspace);
		if (!fs.existsSync(target)) {
			fs.mkdirSync(target, { recursive: true });
			const cleanTitle = prompt.replace(/[\r\n]+/g, ' ').slice(0, 100);
			const readme = `# ${cleanTitle}\n\nAutomated scratch workspace created for prompt:\n> ${prompt}\n`;
			fs.writeFileSync(path.join(target, 'README.md'), readme, 'utf8');
			try {
				await execAsync('git init && git add README.md && git commit -m "init: automated scratch workspace"', { cwd: target, env: getSanitizedEnv() });
			} catch (e) {}
		}
	} else {
		target = resolveSafeWorkspace(activeWorkspace);
	}

	if (!fs.existsSync(target)) {
		throw new Error(`Workspace '${activeWorkspace}' not found`);
	}

	const timestamp = Date.now();
	if (onEvent) await onEvent({ type: 'status', status: 'running', workspace: activeWorkspace });

	// Pre-Fetcher: Auto-clone GitHub repository if prompt contains a GitHub repo URL in a scratch workspace
	const clonedRepo = await autoCloneGitHubRepoIfNeeded(target, prompt, onEvent);
	// Pre-Fetcher: Auto-fetch any external web URLs for DeepSeek context
	const preFetchedWebContext = provider !== 'codex'
		? await prefetchPromptWebUrls(prompt, clonedRepo.repoFullName, onEvent)
		: '';

	// DeepSeek Only
	if (provider === 'deepseek') {
		const taskBranch = branch?.trim() || `agent/deepseek-${timestamp}`;
		if (onEvent) await onEvent({ type: 'stage', stage: 'Executing DeepSeek R1 (14b GPU + ReAct Web/File Agent)...' });
		const result = await runDeepSeekTask(target, prompt, taskBranch, undefined, preFetchedWebContext, onEvent);

		if (onEvent) await onEvent({ type: 'stage', stage: 'Running Evidence Test Gate...' });
		const testEvidence = await runTestGate(target);
		result.testEvidence = testEvidence;

		saveTaskToHistory({
			workspace: activeWorkspace,
			prompt,
			provider: result.provider,
			branch: result.branch,
			status: result.status,
			diff: result.diff,
			logs: result.logs,
			tokens: result.tokens,
			mode: 'single',
			testEvidence
		});
		return { success: true, workspace: activeWorkspace, mode: 'single', ...result, testEvidence };
	}

	// Dual Mode (Worktrees)
	if (provider === 'both') {
		const codexBranch = `agent/codex-${timestamp}`;
		const deepseekBranch = `agent/deepseek-${timestamp}`;

		if (onEvent) await onEvent({ type: 'stage', stage: 'Preparing isolated Git worktrees...' });
		const codexWorktree = await prepareWorktree(target, codexBranch, 'codex');
		const deepseekWorktree = await prepareWorktree(target, deepseekBranch, 'deepseek');

		let codexRes: any;
		let deepseekRes: any;

		try {
			if (onEvent) await onEvent({ type: 'stage', stage: 'Running Codex and DeepSeek concurrently...' });
			const deepseekPromise = runDeepSeekTask(
				target,
				prompt,
				deepseekBranch,
				deepseekWorktree.worktreePath,
				preFetchedWebContext,
				onEvent
			).catch(err => ({
				provider: 'DeepSeek R1 (14b GPU)',
				branch: deepseekBranch,
				status: 'Failed',
				diff: '',
				logs: `DeepSeek Error: ${err.message}`,
				tokens: { total_tokens: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, net_tokens: 0 }
			}));

			codexRes = await runCodexTask(target, prompt, codexBranch, codexWorktree.worktreePath, clonedRepo.cloned);
			deepseekRes = await deepseekPromise;
		} finally {
			await cleanupWorktree(target, codexWorktree, `Codex: ${prompt.slice(0, 50)}`);
			await cleanupWorktree(target, deepseekWorktree, `DeepSeek: ${prompt.slice(0, 50)}`);
		}

		if (onEvent) await onEvent({ type: 'stage', stage: 'Running Evidence Test Gate...' });
		const testEvidence = await runTestGate(target);

		const totalTok = (codexRes.tokens?.total_tokens || 0) + (deepseekRes.tokens?.total_tokens || 0);
		const cachedTok = (codexRes.tokens?.cached_input_tokens || 0) + (deepseekRes.tokens?.cached_input_tokens || 0);
		const combinedTokens = {
			total_tokens: totalTok,
			input_tokens: (codexRes.tokens?.input_tokens || 0) + (deepseekRes.tokens?.input_tokens || 0),
			cached_input_tokens: cachedTok,
			output_tokens: (codexRes.tokens?.output_tokens || 0) + (deepseekRes.tokens?.output_tokens || 0),
			net_tokens: Math.max(0, totalTok - cachedTok)
		};

		saveTaskToHistory({
			workspace: activeWorkspace,
			prompt,
			provider: 'Dual Agents (Codex + DeepSeek)',
			branch: `${codexBranch} & ${deepseekBranch}`,
			status: 'Dual Completed',
			diff: codexRes.diff,
			logs: `=== CODEX LOGS ===\n${codexRes.logs}\n\n=== DEEPSEEK LOGS ===\n${deepseekRes.logs}`,
			tokens: combinedTokens,
			mode: 'both',
			codex: codexRes,
			deepseek: deepseekRes,
			testEvidence
		});

		return {
			success: true,
			workspace: activeWorkspace,
			mode: 'both',
			codex: codexRes,
			deepseek: deepseekRes,
			tokens: combinedTokens,
			testEvidence
		};
	}

	// Multi-Agent Consensus Loop
	if (provider === 'consensus') {
		const codexPropBranch = `agent/codex-prop-${timestamp}`;
		const deepseekPropBranch = `agent/deepseek-prop-${timestamp}`;
		const consensusBranch = branch?.trim() || `agent/consensus-${timestamp}`;
		const taskType = detectTaskType(prompt);

		if (onEvent) await onEvent({ type: 'stage', stage: 'Stage 1: Parallel Generation in Worktrees...' });
		const codexWorktree = await prepareWorktree(target, codexPropBranch, 'codex-prop');
		const deepseekWorktree = await prepareWorktree(target, deepseekPropBranch, 'deepseek-prop');

		let codexProp: any;
		let deepseekProp: any;

		try {
			const deepseekPromise = runDeepSeekTask(
				target,
				prompt,
				deepseekPropBranch,
				deepseekWorktree.worktreePath,
				preFetchedWebContext,
				onEvent
			).catch(err => ({
				provider: 'DeepSeek R1 (14b GPU)',
				branch: deepseekPropBranch,
				status: 'Failed',
				diff: '',
				logs: `DeepSeek Error: ${err.message}`,
				tokens: { total_tokens: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, net_tokens: 0 }
			}));

			codexProp = await runCodexTask(target, prompt, codexPropBranch, codexWorktree.worktreePath, clonedRepo.cloned);
			deepseekProp = await deepseekPromise;
		} finally {
			await cleanupWorktree(target, codexWorktree, `Proposal Codex: ${prompt.slice(0, 50)}`);
			await cleanupWorktree(target, deepseekWorktree, `Proposal DeepSeek: ${prompt.slice(0, 50)}`);
		}

		if (onEvent) await onEvent({ type: 'stage', stage: 'Stage 2: Bilateral Cross-Review (Streaming)...' });
		const deepseekReviewPrompt = `[TASK TYPE: GENERAL CONSULTATION / PEER REVIEW AUDIT]
You are a Principal Software Architect & Auditor conducting a peer review of a solution proposed by OpenAI Codex for the following task.

=== ORIGINAL TASK ===
${prompt}

=== OPENAI CODEX PROPOSAL & OUTPUT ===
${sanitizeForApi(codexProp.logs, 4500)}

=== CODEX'S GIT DIFF ===
${sanitizeForApi(codexProp.diff || '(No diff recorded)', 2500)}

Please provide your rigorous peer review in Thai (and English for technical terms):
1. จุดเด่นของแนวทางนี้ (Key Strengths)
2. จุดบกพร่อง ช่องโหว่ หรือ Edge Cases ที่อาจเกิดขึ้น (Flaws, Vulnerabilities & Edge Cases)
3. ข้อเสนอแนะในการปรับปรุงให้สมบูรณ์ยิ่งขึ้น (Actionable Improvements)`;

		const codexReviewPrompt = `[TASK TYPE: GENERAL CONSULTATION / PEER REVIEW AUDIT]
You are a Principal Software Architect & Auditor conducting a peer review of a solution proposed by DeepSeek R1 for the following task.
IMPORTANT TOKEN-SAVING RULE: Do NOT execute any shell commands (no rg, no cat, no find, no git clone) during this peer review. All necessary context is already provided below. Respond directly based on Proposal B's text and diff.

=== ORIGINAL TASK ===
${prompt}

=== DEEPSEEK R1 PROPOSAL & OUTPUT ===
${sanitizeForApi(deepseekProp.logs, 5000)}

=== DEEPSEEK R1 GIT DIFF ===
${sanitizeForApi(deepseekProp.diff || '(No diff recorded)', 2500)}

Please provide your rigorous peer review in Thai (and English for technical terms):
1. จุดเด่นของแนวทางนี้ (Key Strengths)
2. จุดบกพร่อง ช่องโหว่ หรือ Edge Cases ที่อาจเกิดขึ้น (Flaws, Vulnerabilities & Edge Cases)
3. ข้อเสนอแนะในการปรับปรุงให้สมบูรณ์ยิ่งขึ้น (Actionable Improvements)`;

		let deepseekReviewTokens = { total_tokens: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
		const deepseekReviewPromise = (async () => {
			const revStep = await callKmitlDeepSeekStream(
				[
					{ role: 'system', content: 'You are a Senior Software Architect and Code Auditor providing high-standard constructive peer reviews in Thai.' },
					{ role: 'user', content: deepseekReviewPrompt }
				],
				16384
			);
			deepseekReviewTokens = {
				total_tokens: (revStep.promptTokens || 0) + (revStep.completionTokens || 0),
				input_tokens: revStep.promptTokens || 0,
				cached_input_tokens: revStep.cachedTokens || 0,
				output_tokens: revStep.completionTokens || 0
			};
			const think = revStep.thinking ? `<think>\n${revStep.thinking}\n</think>\n\n` : '';
			return (think + revStep.reply).trim();
		})().catch(err => `DeepSeek Review Error: ${err.message}`);

		const codexReviewPromise = (async () => {
			const res = await execCodexWithStdin(target, codexReviewPrompt, 5 * 60 * 1000);
			return (res.stdout + '\n' + res.stderr).trim();
		})().catch(err => `Codex Review Error: ${err.message}`);

		const [deepseekReviewOfCodex, codexReviewOfDeepSeek] = await Promise.all([
			deepseekReviewPromise,
			codexReviewPromise
		]);

		if (onEvent) await onEvent({ type: 'stage', stage: 'Stage 3: Consensus Harmonization...' });
		const mandateRules = taskType === 'general'
			? `=== YOUR MANDATE (ANALYSIS / ADVISORY MODE — STRICT TOKEN SAVING) ===
1. IMPORTANT: Do NOT run shell commands (\`rg\`, \`cat\`, \`git clone\`) to re-scan the repository from scratch, and do NOT modify or create any files in the workspace.
2. Synthesize the final authoritative Consensus Response directly from the verified facts in Proposal A, Proposal B, and both Peer Reviews below.
3. Conclude with a clear Consensus Summary in Thai explaining what was harmonized and why this consensus is superior to each individual proposal alone.`
			: `=== YOUR MANDATE ===
1. Synthesize the final agreed solution (Consensus Solution), taking the best parts of both proposals and solving all issues raised in the peer reviews.
2. Apply the final, production-ready code directly into the workspace files without unnecessary re-scanning.
3. Conclude with a clear Consensus Summary explaining what was harmonized and why this consensus is superior to each individual proposal alone.`;

		const consensusPrompt = `[TASK TYPE: CONSENSUS HARMONIZATION & FINAL IMPLEMENTATION]
You are the Lead Consensus Multi-Agent Orchestrator.
We have executed a multi-agent debate and peer review between OpenAI Codex and DeepSeek R1.

=== ORIGINAL TASK ===
${prompt}

=== PROPOSAL A (Codex) ===
${codexProp.logs.slice(0, 5000)}
Diff: ${sanitizeForApi(codexProp.diff || 'none', 2500)}

=== PEER REVIEW OF PROPOSAL A (by DeepSeek R1) ===
${deepseekReviewOfCodex.slice(0, 3500)}

=== PROPOSAL B (DeepSeek R1) ===
${deepseekProp.logs.slice(0, 5000)}
Diff: ${sanitizeForApi(deepseekProp.diff || 'none', 2500)}

=== PEER REVIEW OF PROPOSAL B (by Codex) ===
${codexReviewOfDeepSeek.slice(0, 3500)}

${mandateRules}`;

		try {
			await execAsync(`git checkout -b ${consensusBranch}`, { cwd: target });
		} catch (e) {}

		const finalSolution = await runCodexTask(target, consensusPrompt, consensusBranch, undefined, clonedRepo.cloned);

		if (onEvent) await onEvent({ type: 'stage', stage: 'Stage 4: Automated Evidence Test Gate...' });
		const testEvidence = await runTestGate(target);
		finalSolution.testEvidence = testEvidence;

		const consensusData = {
			codexProposal: codexProp,
			deepseekProposal: deepseekProp,
			codexReviewOfDeepSeek,
			deepseekReviewOfCodex,
			finalSolution,
			testEvidence
		};

		const totalTokens = (codexProp.tokens?.total_tokens || 0) +
			(deepseekProp.tokens?.total_tokens || 0) +
			(deepseekReviewTokens.total_tokens || 0) +
			(finalSolution.tokens?.total_tokens || 0);

		const inputTokens = (codexProp.tokens?.input_tokens || 0) +
			(deepseekProp.tokens?.input_tokens || 0) +
			(deepseekReviewTokens.input_tokens || 0) +
			(finalSolution.tokens?.input_tokens || 0);

		const cachedTokens = (codexProp.tokens?.cached_input_tokens || 0) +
			(deepseekProp.tokens?.cached_input_tokens || 0) +
			(deepseekReviewTokens.cached_input_tokens || 0) +
			(finalSolution.tokens?.cached_input_tokens || 0);

		const outputTokens = (codexProp.tokens?.output_tokens || 0) +
			(deepseekProp.tokens?.output_tokens || 0) +
			(deepseekReviewTokens.output_tokens || 0) +
			(finalSolution.tokens?.output_tokens || 0);

		const netTokens = Math.max(0, totalTokens - cachedTokens);

		saveTaskToHistory({
			workspace: activeWorkspace,
			prompt,
			provider: 'Multi-Agent Consensus (Codex + DeepSeek)',
			branch: consensusBranch,
			status: 'Consensus Achieved',
			diff: finalSolution.diff,
			logs: `=== CONSENSUS FINAL HARMONIZATION ===\n${finalSolution.logs}\n\n=== PEER REVIEW: DEEPSEEK ON CODEX ===\n${deepseekReviewOfCodex}\n\n=== PEER REVIEW: CODEX ON DEEPSEEK ===\n${codexReviewOfDeepSeek}\n\n=== INITIAL CODEX PROPOSAL ===\n${codexProp.logs}\n\n=== INITIAL DEEPSEEK PROPOSAL ===\n${deepseekProp.logs}`,
			tokens: {
				total_tokens: totalTokens,
				input_tokens: inputTokens,
				cached_input_tokens: cachedTokens,
				output_tokens: outputTokens,
				net_tokens: netTokens
			},
			mode: 'consensus',
			consensus: consensusData,
			testEvidence
		});

		return {
			success: true,
			workspace: activeWorkspace,
			mode: 'consensus',
			consensus: consensusData,
			branch: consensusBranch,
			status: 'Consensus Achieved',
			diff: finalSolution.diff,
			logs: finalSolution.logs,
			testEvidence,
			tokens: {
				total_tokens: totalTokens,
				input_tokens: inputTokens,
				cached_input_tokens: cachedTokens,
				output_tokens: outputTokens,
				net_tokens: netTokens
			}
		};
	}

	// Custom Registered Models
	const allModels = getModels();
	const matchedModel = allModels.find(m => m.id === provider);
	if (matchedModel && !matchedModel.isBuiltin) {
		const taskBranch = branch?.trim() || `agent/${matchedModel.id}-${timestamp}`;
		if (onEvent) await onEvent({ type: 'stage', stage: `Executing ${matchedModel.name}...` });
		const result = await runCustomModelTask(matchedModel, target, prompt, taskBranch);

		if (onEvent) await onEvent({ type: 'stage', stage: 'Running Evidence Test Gate...' });
		const testEvidence = await runTestGate(target);
		result.testEvidence = testEvidence;

		saveTaskToHistory({
			workspace: activeWorkspace,
			prompt,
			provider: result.provider,
			branch: result.branch,
			status: result.status,
			diff: result.diff,
			logs: result.logs,
			tokens: result.tokens,
			mode: 'single',
			testEvidence
		});
		return { success: true, workspace: activeWorkspace, mode: 'single', ...result, testEvidence };
	}

	// Default: Codex Only
	const taskBranch = branch?.trim() || `agent/codex-${timestamp}`;
	if (onEvent) await onEvent({ type: 'stage', stage: 'Executing OpenAI Codex (gpt-6.1-sol)...' });
	const result = await runCodexTask(target, prompt, taskBranch, undefined, clonedRepo.cloned);

	if (onEvent) await onEvent({ type: 'stage', stage: 'Running Evidence Test Gate...' });
	const testEvidence = await runTestGate(target);
	result.testEvidence = testEvidence;

	saveTaskToHistory({
		workspace: activeWorkspace,
		prompt,
		provider: result.provider,
		branch: result.branch,
		status: result.status,
		diff: result.diff,
		logs: result.logs,
		tokens: result.tokens,
		mode: 'single',
		testEvidence
	});

	return { success: true, workspace: activeWorkspace, mode: 'single', ...result, testEvidence };
}
