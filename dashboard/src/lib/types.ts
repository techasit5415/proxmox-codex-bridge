export interface TokenUsage {
	total_tokens: number;
	input_tokens: number;
	cached_input_tokens: number;
	output_tokens: number;
}

export interface TokenStats {
	totalTokens: number;
	inputTokens: number;
	cachedTokens: number;
	outputTokens: number;
	sessionCount: number;
	latest?: TokenUsage;
}

export interface SystemStatus {
	status: string;
	codexAuth: string;
	diskUsage: string;
	memoryUsage: string;
	nodeVersion: string;
	codexVersion: string;
	tokens?: TokenStats;
}

export interface WorkspaceDetails {
	name: string;
	branch: string;
	clean: boolean;
	statusSummary: string;
	modifiedCount: number;
	untrackedCount: number;
	rawStatus: string;
	recentCommits: string[];
	files: string[];
}

export interface TaskRecord {
	id: string;
	timestamp: number;
	date: string;
	workspace: string;
	provider: string;
	prompt: string;
	branch: string;
	status: string;
	diff: string;
	logs: string;
	tokens?: TokenUsage;
	mode?: 'single' | 'both';
	codex?: TaskResult;
	deepseek?: TaskResult;
}

export interface TaskResult {
	provider: string;
	branch: string;
	status: string;
	diff: string;
	logs: string;
	tokens?: TokenUsage;
}

export function fmtTokens(n: number | undefined | null): string {
	if (n === undefined || n === null) return '0';
	return n.toLocaleString();
}

export function slugifyPrompt(prompt: string): string {
	const clean = (prompt || '')
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 35);
	const id = Math.random().toString(36).substring(2, 6);
	return `temp-${clean || 'scratch'}-${id}`;
}

export function extractThoughtAndBody(raw: string): { thoughts: string; body: string } {
	if (!raw) return { thoughts: '', body: '' };

	// Check for DeepSeek <think>...</think>
	const thinkMatch = raw.match(/<think>([\s\S]*?)<\/think>/i);
	if (thinkMatch) {
		return {
			thoughts: thinkMatch[1].trim(),
			body: raw.replace(/<think>[\s\S]*?<\/think>/i, '').trim()
		};
	}

	// Check for Codex reasoning / planning blocks
	if (raw.includes('OpenAI Codex') || raw.includes('exec\n') || raw.includes('I’ll') || raw.includes("I'll")) {
		const lines = raw.split('\n');
		const thoughts: string[] = [];
		const other: string[] = [];

		for (const line of lines) {
			if (
				line.startsWith('codex') ||
				line.startsWith('user') ||
				line.includes('I’ll') ||
				line.includes("I'll") ||
				line.includes('Created') ||
				line.startsWith('$') ||
				line.startsWith('rg ')
			) {
				thoughts.push(line);
			} else {
				other.push(line);
			}
		}

		return {
			thoughts: thoughts.join('\n'),
			body: other.length > 0 ? other.join('\n') : raw
		};
	}

	return { thoughts: '', body: raw };
}
