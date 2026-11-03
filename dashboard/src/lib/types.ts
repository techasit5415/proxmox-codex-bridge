export interface TokenUsage {
	total_tokens: number;
	input_tokens: number;
	cached_input_tokens: number;
	output_tokens: number;
	net_tokens?: number;
}

export interface TokenStats {
	totalTokens: number;
	netTokens?: number;
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
	diskFree?: string;
	diskPercent?: string;
	memoryUsage: string;
	nodeVersion: string;
	codexVersion: string;
	tokens?: TokenStats;
	redisStatus?: string;
	queueLength?: number | null;
	processingCount?: number | null;
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
	isLocked?: boolean;
}

export interface TestEvidence {
	ran: boolean;
	passed: boolean;
	testCmd: string;
	output: string;
	error?: string;
	type?: 'test_suite' | 'syntax_check' | 'none';
}

export interface TaskResult {
	provider: string;
	branch: string;
	status: string;
	diff: string;
	logs: string;
	tokens?: TokenUsage;
	testEvidence?: TestEvidence;
}

export interface ConsensusData {
	codexProposal: TaskResult;
	deepseekProposal: TaskResult;
	codexReviewOfDeepSeek: string;
	deepseekReviewOfCodex: string;
	finalSolution: TaskResult;
	testEvidence?: TestEvidence;
}

export type TaskJobStatus = 'queued' | 'running' | 'validating' | 'completed' | 'failed' | 'cancelled';

export interface TaskJobData {
	id: string;
	workspace: string;
	prompt: string;
	provider: string;
	branch?: string;
	status: TaskJobStatus;
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
	result?: any;
	error?: string;
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
	diff?: string;
	logs?: string;
	tokens?: TokenUsage;
	mode?: 'single' | 'both' | 'consensus';
	codex?: TaskResult;
	deepseek?: TaskResult;
	consensus?: ConsensusData;
	testEvidence?: TestEvidence;
	jobStatus?: TaskJobStatus;
}

export function fmtTokens(n: number | undefined | null): string {
	if (n === undefined || n === null) return '0';
	return n.toLocaleString();
}

export function getNetTokens(t?: TokenUsage | null): number {
	if (!t) return 0;
	if (typeof t.net_tokens === 'number' && t.net_tokens > 0) return t.net_tokens;
	const total = t.total_tokens || 0;
	const cached = t.cached_input_tokens || 0;
	return Math.max(0, total - cached);
}

export function fmtTokenBadge(t?: TokenUsage | null): string {
	if (!t || !t.total_tokens) return '0 tok';
	const net = getNetTokens(t);
	const cached = t.cached_input_tokens || 0;
	if (cached > 0) {
		const pct = Math.round((cached / t.total_tokens) * 100);
		return `${net.toLocaleString()} net (${t.total_tokens.toLocaleString()} tot · ${pct}% cached)`;
	}
	return `${net.toLocaleString()} tok`;
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

export function detectTaskType(prompt: string): 'code' | 'general' {
	if (!prompt) return 'general';
	const lower = prompt.toLowerCase();

	// Explicit code-editing / file-creation imperatives
	const codeEditKeywords = [
		'แก้โค้ด', 'แก้บั๊ก', 'สร้างไฟล์', 'ลบไฟล์', 'แก้ไขไฟล์', 'เขียนโค้ด',
		'เพิ่มฟังก์ชัน', 'เขียนโปรแกรม', 'สร้างคอมโพเนนต์', 'รันสคริปต์',
		'fix bug', 'refactor', 'implement', 'write code', 'create file', 'modify file'
	];

	// Analysis / explanation / consultation keywords
	const analysisKeywords = [
		'อธิบาย', 'วิเคราะห์', 'สรุป', 'ภาพรวม', 'ภาพใหญ่', 'ข้อดี', 'ข้อเสีย',
		'การทำงานของ', 'ทำงานยังไง', 'คืออะไร', 'ทำไม', 'อย่างไร', 'เปรียบเทียบ',
		'ความเห็น', 'แนะนำ', 'ประเมิน', 'เที่ยว', 'แพลน', 'วางแผน',
		'explain', 'analyze', 'summarize', 'overview', 'architecture', 'pros and cons',
		'how does', 'what is', 'why', 'compare', 'review', 'opinion', 'recommend'
	];

	let hasEditIntent = false;
	for (const kw of codeEditKeywords) {
		if (lower.includes(kw)) {
			hasEditIntent = true;
			break;
		}
	}

	let analysisScore = 0;
	for (const kw of analysisKeywords) {
		if (lower.includes(kw)) analysisScore++;
	}

	// If user asks to explain/analyze/summarize without asking to write/edit code files, treat as 'general' (analysis)
	if (analysisScore > 0 && !hasEditIntent) {
		return 'general';
	}

	const codeKeywords = [
		'code', 'function', 'class', 'bug', 'fix', 'refactor', 'test',
		'component', 'api', 'endpoint', 'npm', 'pip', 'python', 'javascript',
		'typescript', 'svelte', 'react', 'css', 'html', 'git', 'repo',
		'docker', 'database', 'sql', 'script', 'compile', 'build', 'import'
	];

	let codeScore = hasEditIntent ? 3 : 0;
	for (const kw of codeKeywords) {
		if (lower.includes(kw)) codeScore++;
	}

	if (analysisScore > codeScore) return 'general';
	if (codeScore > analysisScore) return 'code';

	if (/[{}<>;`$]/.test(prompt) || /\b(src|app|lib|test|index|package)\b/i.test(prompt)) {
		return 'code';
	}

	return codeScore > 0 ? 'code' : 'general';
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

export interface AIModelConfig {
	id: string;
	name: string;
	type: 'cli' | 'anthropic' | 'openai-compatible' | 'ollama';
	endpoint?: string;
	apiKey?: string;
	modelId?: string;
	badge?: string;
	color?: string;
	active: boolean;
	inConsensus: boolean;
	isBuiltin?: boolean;
}
