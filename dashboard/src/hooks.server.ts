import type { Handle } from '@sveltejs/kit';
import { startTaskWorker } from '$lib/queue';

// Start Redis background task worker
startTaskWorker();

const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY?.trim() || '';

if (BRIDGE_API_KEY) {
	console.log('[Security] API Key authentication is ENFORCED for all /api/* endpoints.');
} else {
	console.warn('[SECURITY NOTICE] BRIDGE_API_KEY is not configured. /api/* endpoints are running in unauthenticated mode.');
}

export const handle: Handle = async ({ event, resolve }) => {
	const pathname = event.url.pathname;

	// Enforce API Key authentication if BRIDGE_API_KEY is set (Bearer Token in Header only, OWASP-compliant)
	if (BRIDGE_API_KEY && pathname.startsWith('/api')) {
		const authHeader = event.request.headers.get('authorization') || '';
		const tokenFromBearer = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : '';

		if (tokenFromBearer !== BRIDGE_API_KEY) {
			return new Response(
				JSON.stringify({
					error: 'Unauthorized: Missing or invalid API key. Provide Authorization: Bearer <token> in request headers.'
				}),
				{
					status: 401,
					headers: { 'Content-Type': 'application/json' }
				}
			);
		}
	}

	return resolve(event);
};
