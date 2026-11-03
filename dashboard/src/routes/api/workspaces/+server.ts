import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import { isWorkspaceLocked } from '$lib/queue';

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
			const target = path.join(WORKSPACES_DIR, dir);
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
