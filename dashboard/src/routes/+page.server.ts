import type { PageServerLoad } from './$types';
import { loadHistorySummaries } from '../lib/history';
import fs from 'fs';

const WORKSPACES_DIR = '/opt/agent-bridge/workspaces';

export const load: PageServerLoad = async () => {
	try {
		const history = loadHistorySummaries(35);
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
	} catch (err) {
		console.error('Error in +page.server.ts load():', err);
		return {
			history: [],
			workspaces: []
		};
	}
};
