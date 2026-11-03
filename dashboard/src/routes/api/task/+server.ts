import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { enqueueTask, getRedisClient, startTaskWorker } from '$lib/queue';
import { executeTaskPipeline } from '$lib/taskRunner';
import type { TaskJobData } from '$lib/types';

// Ensure worker is running
startTaskWorker();

export const GET: RequestHandler = async () => {
	try {
		const redis = getRedisClient();
		const queueLength = await redis.llen('tasks:queue');
		return json({ status: 'ok', queueLength });
	} catch (e: any) {
		return json({ status: 'degraded', error: e.message });
	}
};

export const POST: RequestHandler = async ({ request, url }) => {
	try {
		const { workspace, prompt, branch, provider = 'codex' } = await request.json();
		if (!prompt?.trim()) {
			return json({ error: 'prompt is required' }, { status: 400 });
		}

		const isSync = url.searchParams.get('sync') === 'true';

		// If caller explicitly requested synchronous execution (e.g. legacy script)
		if (isSync) {
			const tempJob: TaskJobData = {
				id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
				workspace: workspace?.trim() || 'auto-temp',
				prompt,
				branch,
				provider,
				status: 'running',
				createdAt: Date.now()
			};
			const result = await executeTaskPipeline(tempJob);
			return json(result);
		}

		// Default: Async Redis Job Queue
		const job = await enqueueTask({
			workspace: workspace?.trim() || 'auto-temp',
			prompt,
			provider,
			branch
		});

		return json(
			{
				success: true,
				taskId: job.id,
				status: job.status,
				workspace: job.workspace,
				provider: job.provider,
				message: 'Task successfully enqueued in Redis Job Queue'
			},
			{ status: 202 }
		);
	} catch (err: any) {
		console.error('[API Task Error]:', err);
		return json({ error: err.message }, { status: 500 });
	}
};
