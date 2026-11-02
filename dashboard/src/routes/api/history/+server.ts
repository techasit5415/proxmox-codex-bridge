import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scanAndSyncCodexSessions, loadExistingHistory } from '../../../lib/history';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const workspace = url.searchParams.get('workspace');
		const history = scanAndSyncCodexSessions();

		let filtered = history;
		if (workspace) {
			filtered = history.filter((h) => !h.workspace || h.workspace === workspace);
		}

		return json({
			success: true,
			history: filtered
		});
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};
