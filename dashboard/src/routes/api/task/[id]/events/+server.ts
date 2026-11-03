import type { RequestHandler } from './$types';
import { getTask, getRedisSubscriber } from '$lib/queue';

export const GET: RequestHandler = async ({ params, request }) => {
	const taskId = params.id;
	if (!taskId) {
		return new Response('Missing taskId', { status: 400 });
	}

	const task = await getTask(taskId);
	const channel = `task:events:${taskId}`;

	let subClient: any = null;
	let interval: any = null;

	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();
			const send = (data: any) => {
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
				} catch (e) {}
			};

			// If task already finished, emit final state and close
			if (task && (task.status === 'completed' || task.status === 'failed')) {
				send({
					type: task.status === 'completed' ? 'done' : 'error',
					status: task.status,
					result: task.result,
					error: task.error,
					testEvidence: task.testEvidence
				});
				controller.close();
				return;
			}

			// Send current initial status
			if (task) {
				send({
					type: 'status',
					status: task.status,
					stage: task.stage,
					workspace: task.workspace
				});
			}

			// Subscribe to Redis pubsub
			try {
				subClient = getRedisSubscriber();
				await subClient.subscribe(channel);

				const messageHandler = (ch: string, message: string) => {
					if (ch === channel) {
						try {
							const parsed = JSON.parse(message);
							send(parsed);
							if (parsed.type === 'done' || parsed.type === 'error') {
								clearInterval(interval);
								subClient.unsubscribe(channel).catch(() => {});
								subClient.removeListener('message', messageHandler);
								controller.close();
							}
						} catch (e) {
							send({ type: 'raw', data: message });
						}
					}
				};

				subClient.on('message', messageHandler);

				// Keep-alive heartbeat every 15s
				interval = setInterval(() => {
					try {
						controller.enqueue(encoder.encode(': keep-alive\n\n'));
					} catch (e) {
						clearInterval(interval);
					}
				}, 15000);

				request.signal.addEventListener('abort', () => {
					clearInterval(interval);
					if (subClient) {
						subClient.unsubscribe(channel).catch(() => {});
						subClient.removeListener('message', messageHandler);
					}
				});
			} catch (err: any) {
				send({ type: 'error', error: err.message });
				controller.close();
			}
		},
		cancel() {
			clearInterval(interval);
			if (subClient) {
				subClient.unsubscribe(channel).catch(() => {});
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			'Connection': 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
