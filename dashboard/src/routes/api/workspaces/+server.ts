import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { isWorkspaceLocked } from '$lib/queue';
import { resolveSafeWorkspace, getSanitizedEnv, WORKSPACES_DIR } from '$lib/taskRunner';

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
		if (!repoUrl || typeof repoUrl !== 'string') {
			return json({ error: 'Valid repoUrl is required' }, { status: 400 });
		}

		// Security: Validate repo URL protocol
		const trimmedUrl = repoUrl.trim();
		if (!trimmedUrl.startsWith('https://') && !trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('git@')) {
			return json({ error: 'Invalid repoUrl: Must start with https:// or git@' }, { status: 400 });
		}

		// Security: Validate folder name (prevent path traversal / sibling escapes)
		let dest = '';
		if (folderName && typeof folderName === 'string' && folderName.trim()) {
			const clean = folderName.trim();
			resolveSafeWorkspace(clean); // throws if path traversal attempted
			dest = clean;
		}

		const gitArgs = ['clone', trimmedUrl];
		if (dest) gitArgs.push(dest);

		// Execute git clone via spawn without shell
		const output = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
			const child = spawn('git', gitArgs, {
				cwd: WORKSPACES_DIR,
				env: getSanitizedEnv(),
				shell: false
			});

			let stdout = '';
			let stderr = '';
			const timer = setTimeout(() => {
				child.kill('SIGKILL');
				reject(new Error('Git clone timed out after 60s'));
			}, 60000);

			child.stdout?.on('data', (d) => { stdout += d.toString(); });
			child.stderr?.on('data', (d) => { stderr += d.toString(); });
			child.on('error', (err) => {
				clearTimeout(timer);
				reject(err);
			});
			child.on('close', (code) => {
				clearTimeout(timer);
				if (code === 0) resolve({ stdout, stderr });
				else reject(new Error(stderr || stdout || `git clone exited with code ${code}`));
			});
		});

		return json({ success: true, message: 'Repo cloned successfully', logs: output.stdout + output.stderr });
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ url }) => {
	try {
		const tempOnly = url.searchParams.get('tempOnly') === 'true';
		if (!fs.existsSync(WORKSPACES_DIR)) {
			return json({ success: true, count: 0 });
		}
		const dirs = fs
			.readdirSync(WORKSPACES_DIR, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => d.name);

		const toDelete = tempOnly ? dirs.filter((d) => d.startsWith('temp-')) : [];
		const deleted: string[] = [];
		const skippedLocked: string[] = [];

		for (const dir of toDelete) {
			const lock = await isWorkspaceLocked(dir);
			if (lock.locked) {
				skippedLocked.push(dir);
				continue;
			}
			// Security: ensure dir stays strictly within WORKSPACES_DIR
			const target = resolveSafeWorkspace(dir);
			fs.rmSync(target, { recursive: true, force: true });
			deleted.push(dir);
		}

		return json({
			success: true,
			deleted,
			count: deleted.length,
			skippedLocked: skippedLocked.length > 0 ? skippedLocked : undefined,
			message: skippedLocked.length > 0
				? `Cleaned ${deleted.length} temp workspaces. Skipped ${skippedLocked.length} active workspaces currently in use by tasks.`
				: `Cleaned ${deleted.length} temp workspaces.`
		});
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};
