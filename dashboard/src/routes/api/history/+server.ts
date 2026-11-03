import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scanAndSyncCodexSessions, loadExistingHistory, loadHistorySummaries } from '../../../lib/history';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const taskId = url.searchParams.get('id');
		if (taskId) {
			const history = loadExistingHistory();
			const task = history.find((t) => t.id === taskId);
			if (!task) {
				return json({ error: 'Task not found' }, { status: 404 });
			}
			return json({ success: true, task });
		}

		const summaryOnly = url.searchParams.get('summary') === 'true';
		const workspace = url.searchParams.get('workspace');

		if (summaryOnly) {
			let summaries = loadHistorySummaries(50);
			if (workspace) {
				summaries = summaries.filter((h) => !h.workspace || h.workspace === workspace);
			}
			return json({
				success: true,
				history: summaries
			});
		}

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
