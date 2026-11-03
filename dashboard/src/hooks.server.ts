import type { Handle } from '@sveltejs/kit';
import { startTaskWorker } from '$lib/queue';

// Start Redis background task worker
startTaskWorker();

export const handle: Handle = async ({ event, resolve }) => {
	return resolve(event);
};
