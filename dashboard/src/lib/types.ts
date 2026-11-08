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
	activeJobs?: TaskJobData[];
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

export interface TaskAttachmentInput {
	name: string;
	mimeType?: string;
	contentBase64: string;
}

export interface TaskAttachmentMeta {
	name: string;
	safeName: string;
	mimeType?: string;
	size: number;
	stagedPath: string;
}

export interface TaskJobData {
	id: string;
	workspace: string;
	prompt: string;
	provider: string;
	branch?: string;
	attachments?: TaskAttachmentMeta[];
	status: TaskJobStatus;
	stage?: string;
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
	result?: any;
	error?: string;
	testEvidence?: TestEvidence;
}

export type ProviderMode = 'codex' | 'deepseek' | 'both' | 'consensus';
export type TaskBadgeType = 'idle' | 'running' | 'success' | 'error';
export type TaskContentType = 'code' | 'general';
export type ResultsActiveTab = 'thoughts' | 'diff' | 'deepseek_diff' | 'tests' | 'logs' | 'files';

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
	attachments?: Array<{ name: string; size: number; mimeType?: string }>;
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

// Re-export utility functions for seamless backwards compatibility
export * from './utils';
