import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTask } from '$lib/queue';

export const GET: RequestHandler = async ({ params }) => {
	try {
		const taskId = params.id;
		if (!taskId) {
			return json({ error: 'taskId is required' }, { status: 400 });
		}

		const task = await getTask(taskId);
		if (!task) {
			return json({ error: 'Task not found' }, { status: 404 });
		}

		return json({ success: true, task });
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};
