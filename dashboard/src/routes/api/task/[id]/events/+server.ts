import type { RequestHandler } from './$types';
import { getTask, getRedisSubscriber } from '$lib/queue';

// Track active SSE subscriber count per Redis channel so one browser tab closing
// never unsubscribes another active listener (e.g. ask_models.py CLI or another tab).
const channelSubscriberCounts = new Map<string, number>();

function retainChannel(subClient: any, channel: string): Promise<void> {
	const current = channelSubscriberCounts.get(channel) || 0;
	channelSubscriberCounts.set(channel, current + 1);
	if (current === 0) {
		return subClient.subscribe(channel).catch(() => {});
	}
	return Promise.resolve();
}

function releaseChannel(subClient: any, channel: string) {
	const current = channelSubscriberCounts.get(channel) || 0;
	if (current <= 1) {
		channelSubscriberCounts.delete(channel);
		subClient?.unsubscribe(channel).catch(() => {});
	} else {
		channelSubscriberCounts.set(channel, current - 1);
	}
}

export const GET: RequestHandler = async ({ params, request }) => {
	const taskId = params.id;
	if (!taskId) {
		return new Response('Missing taskId', { status: 400 });
	}

	const task = await getTask(taskId);
	const channel = `task:events:${taskId}`;

	let subClient: any = null;
	let interval: any = null;
	let closed = false;
	let lastSentStage = task?.stage || '';

	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();
			const send = (data: any) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
				} catch (e) {}
			};

			const cleanupAndClose = (messageHandler?: (...args: any[]) => void) => {
				if (closed) return;
				closed = true;
				if (interval) {
					clearInterval(interval);
					interval = null;
				}
				if (subClient) {
					if (messageHandler) {
						subClient.removeListener('message', messageHandler);
					}
					releaseChannel(subClient, channel);
				}
				try {
					controller.close();
				} catch {}
			};

			// If task already finished, emit final state and close immediately
			if (task && (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled')) {
				send({
					type: task.status === 'completed' ? 'done' : 'error',
					status: task.status,
					result: task.result,
					error: task.error || (task.status === 'cancelled' ? 'Task cancelled' : undefined),
					testEvidence: task.testEvidence
				});
				closed = true;
				try {
					controller.close();
				} catch {}
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

			// Subscribe to Redis pubsub with ref-counting
			try {
				subClient = getRedisSubscriber();
				await retainChannel(subClient, channel);

				const messageHandler = (ch: string, message: string) => {
					if (ch === channel && !closed) {
						try {
							const parsed = JSON.parse(message);
							if (parsed.stage) lastSentStage = parsed.stage;
							send(parsed);
							if (parsed.type === 'done' || parsed.type === 'error') {
								cleanupAndClose(messageHandler);
							}
						} catch (e) {
							send({ type: 'raw', data: message });
						}
					}
				};

				subClient.on('message', messageHandler);

				// Poll getTask every 2.5s as a guaranteed safety net (in case a pubsub packet was missed)
				// and emit SSE keep-alive comment
				interval = setInterval(async () => {
					if (closed) return;
					try {
						const latest = await getTask(taskId);
						if (latest) {
							if (latest.stage && latest.stage !== lastSentStage) {
								lastSentStage = latest.stage;
								send({ type: 'stage', stage: latest.stage });
							}
							if (latest.status === 'completed' || latest.status === 'failed' || latest.status === 'cancelled') {
								send({
									type: latest.status === 'completed' ? 'done' : 'error',
									status: latest.status,
									result: latest.result,
									error: latest.error || (latest.status === 'cancelled' ? 'Task cancelled' : undefined),
									testEvidence: latest.testEvidence
								});
								cleanupAndClose(messageHandler);
								return;
							}
						}
						controller.enqueue(encoder.encode(': keep-alive\n\n'));
					} catch (e) {
						cleanupAndClose(messageHandler);
					}
				}, 2500);

				request.signal.addEventListener('abort', () => {
					cleanupAndClose(messageHandler);
				});
			} catch (err: any) {
				send({ type: 'error', error: err.message });
				cleanupAndClose();
			}
		},
		cancel() {
			if (!closed) {
				closed = true;
				if (interval) clearInterval(interval);
				if (subClient) releaseChannel(subClient, channel);
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
