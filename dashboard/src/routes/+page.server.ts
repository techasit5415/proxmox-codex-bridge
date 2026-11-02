import type { PageServerLoad } from './$types';
import { scanAndSyncCodexSessions } from '../lib/history';
import fs from 'fs';

const WORKSPACES_DIR = '/opt/agent-bridge/workspaces';

export const load: PageServerLoad = async () => {
	const history = scanAndSyncCodexSessions();
	let workspaces: string[] = [];
	try {
		if (fs.existsSync(WORKSPACES_DIR)) {
			workspaces = fs
				.readdirSync(WORKSPACES_DIR, { withFileTypes: true })
				.filter((d) => d.isDirectory())
				.map((d) => d.name);
		}
	} catch (e) {}

	return {
		history,
		workspaces
	};
};
