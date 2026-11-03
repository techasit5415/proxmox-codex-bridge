export const handleError = ({ error, event, status, message }: { error: any; event: any; status: number; message: string }) => {
	console.error('[Client-Side Error]', error);
	const err = error as any;
	return {
		message: err?.message || message || 'An unexpected client error occurred'
	};
};
