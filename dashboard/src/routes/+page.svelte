<script lang="ts">
	import { onMount } from 'svelte';
	import { 
		Terminal, 
		FolderGit2, 
		Play, 
		GitBranch, 
		FileCode, 
		Plus, 
		ExternalLink, 
		Copy, 
		Check, 
		RefreshCw, 
		Layers, 
		Search, 
		Brain, 
		ChevronDown, 
		ChevronRight, 
		SlidersHorizontal,
		History,
		Clock,
		RotateCcw,
		X
	} from 'lucide-svelte';

	interface TokenStats {
		totalTokens: number;
		inputTokens: number;
		cachedTokens: number;
		outputTokens: number;
		sessionCount: number;
		latest?: {
			total_tokens: number;
			input_tokens: number;
			cached_input_tokens: number;
			output_tokens: number;
		};
	}

	interface SystemStatus {
		status: string;
		codexAuth: string;
		diskUsage: string;
		memoryUsage: string;
		nodeVersion: string;
		codexVersion: string;
		tokens?: TokenStats;
	}

	interface WorkspaceDetails {
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

	interface TaskRecord {
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
		tokens?: {
			total_tokens: number;
			input_tokens: number;
			cached_input_tokens: number;
			output_tokens: number;
		};
		mode?: 'single' | 'both';
		codex?: any;
		deepseek?: any;
	}

	interface TaskResult {
		provider: string;
		branch: string;
		status: string;
		diff: string;
		logs: string;
		tokens?: {
			total_tokens: number;
			input_tokens: number;
			cached_input_tokens: number;
			output_tokens: number;
		};
	}

	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();

	// State
	let status = $state<SystemStatus | null>(null);
	let workspaces = $state<string[]>(data.workspaces || []);
	let activeWs = $state<string>(data.workspaces?.[0] || 'Android-Tv');
	let wsDetails = $state<WorkspaceDetails | null>(null);

	// History state
	const initHistory = data.history || [];
	const firstTask = initHistory[0] || null;

	let history = $state<TaskRecord[]>(initHistory);
	let selectedTaskId = $state<string | null>(firstTask?.id || null);
	let isLoadingHistory = $state<boolean>(false);
	let historyFilter = $state<'all' | 'codex' | 'deepseek' | 'both'>('all');

	let prompt = $state<string>(firstTask?.prompt || '');
	let branch = $state<string>('');
	let provider = $state<'codex' | 'deepseek' | 'both'>('codex');
	let isExecuting = $state<boolean>(false);
	let taskBadge = $state<string>(firstTask ? 'Loaded from History' : 'Ready');
	let taskBadgeType = $state<'idle' | 'running' | 'success' | 'error'>('idle');

	// Execution outputs & Model Views
	let activeTab = $state<'diff' | 'deepseek_diff' | 'thoughts' | 'logs' | 'files'>('thoughts');
	let activeModelView = $state<'split' | 'codex' | 'deepseek'>(firstTask?.mode === 'both' ? 'split' : (firstTask?.provider?.includes('DeepSeek') ? 'deepseek' : 'codex'));
	let singleResult = $state<TaskResult | null>(
		firstTask && firstTask.mode !== 'both'
			? {
					provider: firstTask.provider,
					branch: firstTask.branch,
					status: firstTask.status,
					diff: firstTask.diff,
					logs: firstTask.logs,
					tokens: firstTask.tokens
				}
			: null
	);
	let dualCodex = $state<TaskResult | null>(firstTask?.mode === 'both' ? firstTask.codex : null);
	let dualDeepSeek = $state<TaskResult | null>(firstTask?.mode === 'both' ? firstTask.deepseek : null);

	// Search & Filter state for logs & thoughts
	let searchQuery = $state<string>('');
	let logFilter = $state<'all' | 'thoughts' | 'exec' | 'error'>('all');
	let expandThoughts = $state<boolean>(false);
	let expandCodexDiff = $state<boolean>(false);
	let expandDeepSeekDiff = $state<boolean>(false);

	// Computed filtered history based on active filter pill
	let filteredHistory = $derived.by(() => {
		if (historyFilter === 'all') return history;
		if (historyFilter === 'codex') return history.filter(h => h.mode !== 'both' && !h.provider?.includes('Dual') && (h.provider?.includes('Codex') || !h.provider?.includes('DeepSeek')));
		if (historyFilter === 'deepseek') return history.filter(h => h.mode !== 'both' && !h.provider?.includes('Dual') && h.provider?.includes('DeepSeek'));
		if (historyFilter === 'both') return history.filter(h => h.mode === 'both' || h.provider?.includes('Dual'));
		return history;
	});

	function countHistory(type: 'codex' | 'deepseek' | 'both'): number {
		if (type === 'codex') return history.filter(h => h.mode !== 'both' && !h.provider?.includes('Dual') && (h.provider?.includes('Codex') || !h.provider?.includes('DeepSeek'))).length;
		if (type === 'deepseek') return history.filter(h => h.mode !== 'both' && !h.provider?.includes('Dual') && h.provider?.includes('DeepSeek')).length;
		if (type === 'both') return history.filter(h => h.mode === 'both' || h.provider?.includes('Dual')).length;
		return 0;
	}

	// Tokens
	let tokenStats = $state<TokenStats | null>(
		firstTask?.tokens
			? {
					totalTokens: firstTask.tokens.total_tokens || 0,
					inputTokens: firstTask.tokens.input_tokens || 0,
					cachedTokens: firstTask.tokens.cached_input_tokens || 0,
					outputTokens: firstTask.tokens.output_tokens || 0,
					sessionCount: initHistory.length,
					latest: firstTask.tokens
				}
			: null
	);

	// Modal
	let showCloneModal = $state<boolean>(false);
	let cloneUrl = $state<string>('');
	let cloneFolder = $state<string>('');
	let isCloning = $state<boolean>(false);

	// Terminal
	let quickCmd = $state<string>('');
	let isRunningCmd = $state<boolean>(false);
	let terminalLogs = $state<string>('');
	let copied = $state<boolean>(false);

	async function fetchStatus() {
		try {
			const res = await fetch('/api/status');
			if (res.ok) {
				status = await res.json();
				if (status?.tokens && !selectedTaskId) tokenStats = status.tokens;
			}
		} catch (e) {
			console.error(e);
		}
	}

	async function fetchWorkspaces() {
		try {
			const res = await fetch('/api/workspaces');
			if (res.ok) {
				const data = await res.json();
				workspaces = data.workspaces;
				if (!workspaces.includes(activeWs) && workspaces.length > 0) {
					activeWs = workspaces[0];
				}
				fetchWorkspaceDetails(activeWs);
			}
		} catch (e) {
			console.error(e);
		}
	}

	async function fetchWorkspaceDetails(name: string) {
		try {
			const res = await fetch(`/api/workspaces/${name}`);
			if (res.ok) wsDetails = await res.json();
		} catch (e) {
			console.error(e);
		}
	}

	function selectWorkspace(ws: string) {
		activeWs = ws;
		fetchWorkspaceDetails(ws);
	}

	async function fetchHistory(autoSelectLatest = false) {
		isLoadingHistory = true;
		try {
			const res = await fetch('/api/history');
			if (res.ok) {
				const data = await res.json();
				history = data.history || [];
				if (autoSelectLatest && history.length > 0 && !singleResult && !dualCodex && !isExecuting) {
					selectHistoryTask(history[0]);
				}
			}
		} catch (e) {
			console.error('Error fetching history:', e);
		} finally {
			isLoadingHistory = false;
		}
	}

	function selectHistoryTask(item: TaskRecord) {
		selectedTaskId = item.id;
		prompt = item.prompt || '';
		
		if (item.workspace && item.workspace !== activeWs && workspaces.includes(item.workspace)) {
			activeWs = item.workspace;
			fetchWorkspaceDetails(item.workspace);
		}

		if (item.mode === 'both' && item.codex && item.deepseek) {
			dualCodex = item.codex;
			dualDeepSeek = item.deepseek;
			singleResult = null;
			provider = 'both';
			activeModelView = 'split';
		} else {
			singleResult = {
				provider: item.provider,
				branch: item.branch,
				status: item.status,
				diff: item.diff,
				logs: item.logs,
				tokens: item.tokens
			};
			dualCodex = null;
			dualDeepSeek = null;
			if (item.provider?.includes('DeepSeek')) {
				provider = 'deepseek';
				activeModelView = 'deepseek';
			} else {
				provider = 'codex';
				activeModelView = 'codex';
			}
		}

		taskBadge = 'Loaded from History';
		taskBadgeType = 'idle';
		activeTab = 'thoughts';

		if (item.tokens) {
			tokenStats = {
				totalTokens: item.tokens.total_tokens || 0,
				inputTokens: item.tokens.input_tokens || 0,
				cachedTokens: item.tokens.cached_input_tokens || 0,
				outputTokens: item.tokens.output_tokens || 0,
				sessionCount: history.length,
				latest: item.tokens
			};
		}
	}

	function clearSelectedTask() {
		selectedTaskId = null;
		prompt = '';
		branch = '';
		singleResult = null;
		dualCodex = null;
		dualDeepSeek = null;
		taskBadge = 'Ready';
		taskBadgeType = 'idle';
		fetchStatus();
	}

	function formatTime(ts: number): string {
		if (!ts) return '';
		const d = new Date(ts);
		const isToday = new Date().toDateString() === d.toDateString();
		const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		if (isToday) return timeStr;
		return `${d.getMonth() + 1}/${d.getDate()} ${timeStr}`;
	}

	async function executeTask() {
		if (!prompt.trim() || isExecuting) return;
		isExecuting = true;
		selectedTaskId = null;
		taskBadge = provider === 'both' ? 'Running Dual Agents...' : 'Executing...';
		taskBadgeType = 'running';

		try {
			const res = await fetch('/api/task', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ workspace: activeWs, prompt, branch, provider })
			});
			const data = await res.json();

			if (data.success) {
				taskBadge = 'Completed';
				taskBadgeType = 'success';
				
				if (data.mode === 'both') {
					dualCodex = data.codex;
					dualDeepSeek = data.deepseek;
					singleResult = null;
					activeModelView = 'split';
				} else {
					singleResult = data;
					dualCodex = null;
					dualDeepSeek = null;
					activeModelView = provider === 'deepseek' ? 'deepseek' : 'codex';
				}

				activeTab = 'thoughts';
				fetchWorkspaceDetails(activeWs);
				fetchStatus();
				await fetchHistory(false);
			} else {
				taskBadge = 'Failed';
				taskBadgeType = 'error';
			}
		} catch (err: any) {
			taskBadge = 'Error';
			taskBadgeType = 'error';
		} finally {
			isExecuting = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			executeTask();
		}
	}

	async function runTerminalCommand() {
		if (!quickCmd.trim()) return;
		isRunningCmd = true;
		activeTab = 'logs';
		terminalLogs = `$ ${quickCmd}\nRunning in ${activeWs}...\n`;

		try {
			const res = await fetch('/api/terminal', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ workspace: activeWs, command: quickCmd })
			});
			const data = await res.json();
			terminalLogs = `$ ${quickCmd}\n\n` + (data.output || data.error || '(no output)');
			quickCmd = '';
			fetchWorkspaceDetails(activeWs);
		} catch (err: any) {
			terminalLogs += `\nError: ${err.message}`;
		} finally {
			isRunningCmd = false;
		}
	}

	async function handleClone() {
		if (!cloneUrl.trim()) return;
		isCloning = true;

		try {
			const res = await fetch('/api/workspaces', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ repoUrl: cloneUrl, folderName: cloneFolder })
			});
			const data = await res.json();
			if (data.success) {
				showCloneModal = false;
				cloneUrl = '';
				cloneFolder = '';
				fetchWorkspaces();
			} else {
				alert(data.error);
			}
		} catch (err: any) {
			alert(err.message);
		} finally {
			isCloning = false;
		}
	}

	function getCurrentDiff(): string {
		if (dualCodex && dualDeepSeek) {
			return activeTab === 'deepseek_diff' ? dualDeepSeek.diff : dualCodex.diff;
		}
		return singleResult?.diff || '';
	}

	function copyCurrentDiff() {
		const d = getCurrentDiff();
		if (!d) return;
		navigator.clipboard.writeText(d);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	function fmt(n: number | undefined): string {
		if (n === undefined || n === null) return '0';
		return n.toLocaleString();
	}

	// Extracts thought process and reasoning
	function extractThoughtAndBody(raw: string) {
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
		if (raw.includes('OpenAI Codex') || raw.includes('exec\n')) {
			const lines = raw.split('\n');
			const thoughts: string[] = [];
			const other: string[] = [];

			for (const line of lines) {
				if (line.startsWith('codex') || line.startsWith('user') || line.includes('I’ll') || line.includes("I'll") || line.includes('Created')) {
					thoughts.push(line);
				} else {
					other.push(line);
				}
			}

			return {
				thoughts: thoughts.join('\n'),
				body: other.join('\n')
			};
		}

		return { thoughts: '', body: raw };
	}

	function getActiveRawLogs(): string {
		if (dualCodex && dualDeepSeek) {
			return `=== CODEX LOGS ===\n${dualCodex.logs}\n\n=== DEEPSEEK R1 LOGS ===\n${dualDeepSeek.logs}`;
		}
		return singleResult?.logs || terminalLogs || '';
	}

	// Filtered lines with search query
	function getFilteredLogLines(text: string): { line: string; matched: boolean }[] {
		if (!text) return [];
		const lines = text.split('\n');
		const q = searchQuery.toLowerCase().trim();

		return lines.map(line => {
			const lower = line.toLowerCase();
			let matchFilter = true;
			if (logFilter === 'thoughts') matchFilter = lower.includes('think') || lower.includes('plan') || lower.includes('i will') || lower.includes('i’ll');
			else if (logFilter === 'exec') matchFilter = lower.includes('exec') || lower.includes('$') || lower.includes('/bin/bash') || lower.includes('rg');
			else if (logFilter === 'error') matchFilter = lower.includes('error') || lower.includes('fail');

			const matchSearch = q ? lower.includes(q) : true;
			return {
				line,
				matched: matchFilter && matchSearch
			};
		}).filter(item => item.matched);
	}

	onMount(async () => {
		if (data.workspaces && data.workspaces.length > 0) {
			workspaces = data.workspaces;
			if (!workspaces.includes(activeWs)) activeWs = data.workspaces[0];
		}
		if (data.history && data.history.length > 0) {
			history = data.history;
			selectHistoryTask(data.history[0]);
		}

		fetchStatus();
		fetchWorkspaces();
		if (activeWs) fetchWorkspaceDetails(activeWs);

		const statusInterval = setInterval(fetchStatus, 5000);
		const historyInterval = setInterval(async () => {
			if (!isExecuting) {
				try {
					const res = await fetch('/api/history');
					if (res.ok) {
						const d = await res.json();
						const newHistory: TaskRecord[] = d.history || [];
						if (newHistory.length > 0 && (!history.length || newHistory[0].id !== history[0].id)) {
							history = newHistory;
							selectHistoryTask(newHistory[0]);
						} else {
							history = newHistory;
						}
					}
				} catch (e) {}
			}
		}, 4000);

		return () => {
			clearInterval(statusInterval);
			clearInterval(historyInterval);
		};
	});
</script>

<!-- Top Navbar -->
<header class="border-b border-zinc-800 bg-zinc-950 px-5 py-3 flex items-center justify-between text-xs">
	<div class="flex items-center gap-3">
		<span class="font-bold text-sm tracking-tight text-zinc-100">codex</span>
		<span class="text-zinc-600">/</span>
		<span class="font-mono text-zinc-300 font-medium">{activeWs}</span>
	</div>

	<!-- System Badges & GPU Cluster -->
	<div class="flex items-center gap-3 font-mono text-[11px] text-zinc-400">
		<div class="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300">
			<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
			<span>{status?.codexAuth || 'ChatGPT Plus'}</span>
		</div>

		<div class="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-violet-300">
			<span class="w-1.5 h-1.5 rounded-full bg-violet-400"></span>
			<span>KMITL GPU (14b)</span>
		</div>

		{#if tokenStats}
			<div class="hidden md:flex items-center gap-1 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300">
				<span class="text-zinc-500">Tokens:</span>
				<strong class="text-zinc-100">{fmt(tokenStats.totalTokens)}</strong>
			</div>
		{/if}

		<div class="hidden lg:flex items-center gap-1 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800">
			<span class="text-zinc-500">RAM:</span>
			<span>{status?.memoryUsage || '...'}</span>
		</div>

		<a 
			href="https://github.com/techasit5415/proxmox-codex-bridge" 
			target="_blank" 
			rel="noreferrer"
			class="text-zinc-400 hover:text-zinc-200 transition flex items-center gap-1 pl-1"
		>
			<span>Repo</span>
			<ExternalLink class="w-3 h-3 text-zinc-500" />
		</a>
	</div>
</header>

<!-- Workspace & Task Grid -->
<div class="flex-1 max-w-7xl w-full mx-auto p-5 flex flex-col lg:flex-row gap-5">

	<!-- Left Sidebar: Workspaces & Repo Info -->
	<aside class="w-full lg:w-64 flex flex-col gap-4 shrink-0">
		
		<!-- Workspaces List -->
		<div class="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3.5 flex flex-col gap-2.5">
			<div class="flex items-center justify-between text-xs">
				<span class="font-medium text-zinc-400">Workspaces</span>
				<button 
					onclick={() => (showCloneModal = true)}
					class="text-[11px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition flex items-center gap-1"
				>
					<Plus class="w-2.5 h-2.5" />
					<span>Clone</span>
				</button>
			</div>

			<div class="flex flex-col gap-1">
				{#each workspaces as ws}
					<button 
						onclick={() => selectWorkspace(ws)}
						class="w-full text-left px-2.5 py-1.5 rounded text-xs font-mono transition flex items-center justify-between {ws === activeWs ? 'bg-zinc-800 text-zinc-100 font-semibold' : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-300'}"
					>
						<span class="truncate">{ws}</span>
						{#if ws === activeWs}
							<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
						{/if}
					</button>
				{/each}
			</div>
		</div>

		<!-- Active Repo Status -->
		{#if wsDetails}
			<div class="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3.5 flex flex-col gap-2 text-xs">
				<div class="flex items-center justify-between font-mono">
					<div class="flex items-center gap-1.5 text-zinc-300">
						<GitBranch class="w-3 h-3 text-zinc-400" />
						<span class="font-semibold">{wsDetails.branch}</span>
					</div>
					<span class="text-[10px] px-1.5 py-0.5 rounded font-mono {wsDetails.clean ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-300 border border-amber-500/20'}">
						{wsDetails.statusSummary}
					</span>
				</div>

				<div class="text-[11px] text-zinc-500 flex justify-between pt-1 border-t border-zinc-800/60 font-mono">
					<span>Tracked Files</span>
					<span class="text-zinc-300">{wsDetails.files.length}</span>
				</div>
			</div>
		{/if}

		<!-- Recent Runs / Task History -->
		<div class="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 flex flex-col gap-2">
			<div class="flex items-center justify-between text-xs">
				<div class="flex items-center gap-1.5 text-zinc-400 font-medium">
					<History class="w-3.5 h-3.5 text-zinc-500" />
					<span>History</span>
					<span class="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 font-mono">{filteredHistory.length}</span>
				</div>
				<button 
					onclick={() => fetchHistory(false)}
					title="Refresh History"
					class="text-zinc-500 hover:text-zinc-300 transition"
				>
					<RotateCcw class="w-3 h-3 {isLoadingHistory ? 'animate-spin' : ''}" />
				</button>
			</div>

			<!-- Quick Model Filter Pills -->
			<div class="grid grid-cols-4 gap-1 p-0.5 bg-zinc-950/80 rounded-md border border-zinc-800/80 text-[10px] font-mono">
				<button 
					onclick={() => (historyFilter = 'all')}
					class="py-0.5 rounded transition text-center {historyFilter === 'all' ? 'bg-zinc-800 text-zinc-100 font-semibold' : 'text-zinc-500 hover:text-zinc-300'}"
				>
					All ({history.length})
				</button>
				<button 
					onclick={() => (historyFilter = 'codex')}
					class="py-0.5 rounded transition text-center {historyFilter === 'codex' ? 'bg-zinc-800 text-emerald-400 font-semibold border border-zinc-700' : 'text-zinc-500 hover:text-zinc-300'}"
				>
					Codex ({countHistory('codex')})
				</button>
				<button 
					onclick={() => (historyFilter = 'deepseek')}
					class="py-0.5 rounded transition text-center {historyFilter === 'deepseek' ? 'bg-violet-950 text-violet-300 border border-violet-800 font-semibold' : 'text-zinc-500 hover:text-zinc-300'}"
				>
					R1 ({countHistory('deepseek')})
				</button>
				<button 
					onclick={() => (historyFilter = 'both')}
					class="py-0.5 rounded transition text-center {historyFilter === 'both' ? 'bg-indigo-950 text-indigo-300 border border-indigo-800 font-semibold' : 'text-zinc-500 hover:text-zinc-300'}"
				>
					Dual ({countHistory('both')})
				</button>
			</div>

			<div class="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-0.5">
				{#each filteredHistory as item}
					<button
						onclick={() => selectHistoryTask(item)}
						class="w-full text-left p-2 rounded text-xs transition border flex flex-col gap-1 {selectedTaskId === item.id ? 'bg-zinc-800 border-zinc-700 text-zinc-100 shadow-xs' : 'bg-zinc-950/40 border-zinc-900 text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-300'}"
					>
						<div class="flex items-center justify-between font-mono text-[10px]">
							<span class="px-1.5 py-0.2 rounded font-medium {item.mode === 'both' || item.provider?.includes('Dual') ? 'bg-indigo-950/80 text-indigo-300 border border-indigo-800/80' : item.provider?.includes('DeepSeek') ? 'bg-violet-950/70 text-violet-300 border border-violet-800/60' : 'bg-zinc-800 text-zinc-300 border border-zinc-700'}">
								{item.mode === 'both' || item.provider?.includes('Dual') ? 'Dual' : item.provider?.includes('DeepSeek') ? 'DeepSeek' : 'Codex'}
							</span>
							<span class="text-zinc-500">{formatTime(item.timestamp)}</span>
						</div>
						<div class="text-[11px] truncate text-zinc-200 font-sans">
							{item.prompt || '(No prompt)'}
						</div>
						<div class="flex items-center justify-between font-mono text-[10px] text-zinc-500">
							<span class="truncate max-w-[100px]">{item.workspace}</span>
							<span>{fmt(item.tokens?.total_tokens)} tok</span>
						</div>
					</button>
				{:else}
					<div class="text-[11px] text-zinc-600 italic py-2 text-center">No past runs yet.</div>
				{/each}
			</div>
		</div>

		<!-- Minimal Command Line -->
		<div class="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 flex flex-col gap-2">
			<span class="text-[11px] font-medium text-zinc-400">Quick Command</span>
			<div class="flex gap-1.5">
				<input 
					type="text" 
					bind:value={quickCmd}
					placeholder="npm test, git status..."
					onkeydown={(e) => e.key === 'Enter' && runTerminalCommand()}
					class="w-full px-2.5 py-1 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-700 placeholder:text-zinc-600"
				/>
				<button 
					onclick={runTerminalCommand}
					disabled={isRunningCmd}
					class="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-xs rounded font-medium text-zinc-300 transition"
				>
					{isRunningCmd ? '...' : 'Run'}
				</button>
			</div>
		</div>

	</aside>

	<!-- Main Task & Results Area -->
	<main class="flex-1 flex flex-col gap-4 min-w-0">

		<!-- Task Input Card with Clean Provider Switcher -->
		<div class="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 flex flex-col gap-3">
			{#if selectedTaskId}
				<div class="flex items-center justify-between px-3 py-1.5 rounded-md bg-zinc-950/80 border border-zinc-800 text-xs">
					<div class="flex items-center gap-1.5 text-zinc-300">
						<Clock class="w-3.5 h-3.5 text-amber-400" />
						<span class="text-zinc-400">Viewing archived task run</span>
					</div>
					<button 
						onclick={clearSelectedTask}
						class="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] transition font-medium flex items-center gap-1"
					>
						<Plus class="w-3 h-3" />
						<span>New Task</span>
					</button>
				</div>
			{/if}

			<div class="flex items-center justify-between text-xs flex-wrap gap-2">
				<div class="flex items-center gap-1.5">
					<span class="font-medium text-zinc-300">Prompt</span>
				</div>

				<!-- Clean Segmented Control: Choose Provider -->
				<div class="flex rounded-md bg-zinc-950 p-0.5 border border-zinc-800 text-[11px] font-medium">
					<button 
						onclick={() => (provider = 'codex')}
						class="px-2.5 py-1 rounded transition {provider === 'codex' ? 'bg-zinc-800 text-zinc-100 font-semibold' : 'text-zinc-500 hover:text-zinc-300'}"
					>
						Codex (ChatGPT)
					</button>
					<button 
						onclick={() => (provider = 'deepseek')}
						class="px-2.5 py-1 rounded transition {provider === 'deepseek' ? 'bg-zinc-800 text-zinc-100 font-semibold' : 'text-zinc-500 hover:text-zinc-300'}"
					>
						DeepSeek R1 (GPU)
					</button>
					<button 
						onclick={() => (provider = 'both')}
						class="px-2.5 py-1 rounded transition flex items-center gap-1 {provider === 'both' ? 'bg-indigo-600 text-white font-semibold' : 'text-zinc-500 hover:text-zinc-300'}"
					>
						<Layers class="w-3 h-3" />
						<span>Both (Compare)</span>
					</button>
				</div>
			</div>

			<textarea 
				bind:value={prompt}
				onkeydown={handleKeydown}
				rows="3"
				placeholder="What should the agent(s) do? (⌘+Enter to execute)"
				class="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-zinc-700 resize-none font-mono placeholder:text-zinc-600 leading-relaxed"
			></textarea>

			<div class="flex items-center justify-between gap-3 pt-0.5">
				<input 
					type="text" 
					bind:value={branch}
					placeholder={provider === 'both' ? 'Branches: agent/codex-* & agent/deepseek-*' : 'Branch: auto (or specify)'}
					class="px-2.5 py-1 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-zinc-300 focus:outline-none focus:border-zinc-700 placeholder:text-zinc-600 flex-1 max-w-sm"
				/>

				<button 
					onclick={executeTask}
					disabled={isExecuting || !prompt.trim()}
					class="px-4 py-1.5 rounded-lg bg-zinc-100 hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 font-semibold text-xs transition flex items-center gap-1.5 cursor-pointer shrink-0"
				>
					{#if isExecuting}
						<RefreshCw class="w-3 h-3 animate-spin" />
						<span>{provider === 'both' ? 'Running Both...' : 'Executing...'}</span>
					{:else}
						<Play class="w-3 h-3 fill-current" />
						<span>{provider === 'both' ? 'Run Dual Agents' : 'Execute'}</span>
					{/if}
				</button>
			</div>
		</div>

		<!-- Results Viewer with Searchable Logs & Thought Inspector -->
		<div class="rounded-lg border border-zinc-800 bg-zinc-900/30 flex-1 flex flex-col overflow-hidden min-h-[480px]">
			<!-- Header Tabs -->
			<div class="flex items-center justify-between border-b border-zinc-800 px-3 bg-zinc-950">
				<div class="flex items-center overflow-x-auto text-xs">
					<button 
						onclick={() => (activeTab = 'thoughts')}
						class="px-3 py-2.5 font-medium border-b-2 transition shrink-0 flex items-center gap-1.5 {activeTab === 'thoughts' ? 'border-violet-400 text-violet-300' : 'border-transparent text-zinc-500 hover:text-zinc-300'}"
					>
						<Brain class="w-3.5 h-3.5" />
						<span>Response & Reasoning</span>
					</button>

					{#if dualCodex && dualDeepSeek}
						<button 
							onclick={() => (activeTab = 'diff')}
							class="px-3 py-2.5 font-medium border-b-2 transition shrink-0 {activeTab === 'diff' ? 'border-zinc-200 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'}"
						>
							Codex Diff ({dualCodex.branch})
						</button>
						<button 
							onclick={() => (activeTab = 'deepseek_diff')}
							class="px-3 py-2.5 font-medium border-b-2 transition shrink-0 {activeTab === 'deepseek_diff' ? 'border-violet-400 text-violet-300' : 'border-transparent text-zinc-500 hover:text-zinc-300'}"
						>
							DeepSeek Diff ({dualDeepSeek.branch})
						</button>
					{:else}
						<button 
							onclick={() => (activeTab = 'diff')}
							class="px-3.5 py-2.5 font-medium border-b-2 transition {activeTab === 'diff' ? 'border-zinc-200 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'}"
						>
							Git Diff {singleResult?.branch ? `(${singleResult.branch})` : ''}
						</button>
					{/if}

					<button 
						onclick={() => (activeTab = 'logs')}
						class="px-3.5 py-2.5 font-medium border-b-2 transition shrink-0 {activeTab === 'logs' ? 'border-zinc-200 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'}"
					>
						Raw Logs
					</button>
					
					<button 
						onclick={() => (activeTab = 'files')}
						class="px-3.5 py-2.5 font-medium border-b-2 transition shrink-0 {activeTab === 'files' ? 'border-zinc-200 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'}"
					>
						Files & History
					</button>
				</div>

				<div class="flex items-center gap-3">
					{#if (activeTab === 'diff' || activeTab === 'deepseek_diff') && getCurrentDiff()}
						<button 
							onclick={copyCurrentDiff}
							class="text-[11px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center gap-1 transition font-mono"
						>
							{#if copied}
								<Check class="w-3 h-3 text-emerald-400" />
								<span>Copied</span>
							{:else}
								<Copy class="w-3 h-3" />
								<span>Copy</span>
							{/if}
						</button>
					{/if}
					<span class="text-[11px] font-mono {taskBadgeType === 'running' ? 'text-amber-400 animate-pulse' : taskBadgeType === 'success' ? 'text-emerald-400' : taskBadgeType === 'error' ? 'text-rose-400' : 'text-zinc-500'}">
						{taskBadge}
					</span>
				</div>
			</div>

			<!-- Search & Filter Toolbar (for Thoughts and Logs) -->
			{#if activeTab === 'thoughts' || activeTab === 'logs'}
				<div class="px-3 py-2 bg-zinc-950/80 border-b border-zinc-800/80 flex items-center justify-between gap-3 text-xs flex-wrap">
					<!-- Search Box -->
					<div class="relative flex-1 min-w-[200px]">
						<Search class="w-3.5 h-3.5 absolute left-2.5 top-2 text-zinc-500" />
						<input 
							type="text" 
							bind:value={searchQuery}
							placeholder="Search thoughts, commands, files, or errors..."
							class="w-full pl-8 pr-3 py-1 bg-zinc-900 border border-zinc-800 rounded text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-700 placeholder:text-zinc-600"
						/>
						{#if searchQuery}
							<button onclick={() => (searchQuery = '')} class="absolute right-2.5 top-1.5 text-zinc-500 hover:text-zinc-300 text-[11px]">&times;</button>
						{/if}
					</div>

					<!-- Filter Pills -->
					<div class="flex items-center gap-1 text-[11px]">
						<button 
							onclick={() => (logFilter = 'all')}
							class="px-2 py-0.5 rounded transition {logFilter === 'all' ? 'bg-zinc-800 text-zinc-100 font-semibold' : 'text-zinc-500 hover:text-zinc-300'}"
						>
							All
						</button>
						<button 
							onclick={() => (logFilter = 'thoughts')}
							class="px-2 py-0.5 rounded transition {logFilter === 'thoughts' ? 'bg-violet-950/60 text-violet-300 border border-violet-800/60 font-semibold' : 'text-zinc-500 hover:text-zinc-300'}"
						>
							Thoughts
						</button>
						<button 
							onclick={() => (logFilter = 'exec')}
							class="px-2 py-0.5 rounded transition {logFilter === 'exec' ? 'bg-cyan-950/60 text-cyan-300 border border-cyan-800/60 font-semibold' : 'text-zinc-500 hover:text-zinc-300'}"
						>
							Exec/Commands
						</button>
						<button 
							onclick={() => (logFilter = 'error')}
							class="px-2 py-0.5 rounded transition {logFilter === 'error' ? 'bg-rose-950/60 text-rose-300 border border-rose-800/60 font-semibold' : 'text-zinc-500 hover:text-zinc-300'}"
						>
							Errors
						</button>
					</div>
				</div>
			{/if}

			<!-- Tab Content Area -->
			<div class="p-3.5 flex-1 overflow-auto bg-zinc-950 font-mono text-xs">
				<!-- RESPONSE & REASONING TAB -->
				{#if activeTab === 'thoughts'}
					{#if dualCodex && dualDeepSeek}
						<!-- Dual Model Switcher Toolbar -->
						<div class="mb-3.5 flex items-center justify-between gap-3 p-2 bg-zinc-900/60 rounded-lg border border-zinc-800 text-xs font-mono flex-wrap">
							<div class="flex items-center gap-2">
								<span class="text-zinc-400 text-[11px] font-sans">Model View:</span>
								<div class="flex rounded-md bg-zinc-950 p-0.5 border border-zinc-800 text-[11px]">
									<button 
										onclick={() => (activeModelView = 'split')}
										class="px-2.5 py-1 rounded transition flex items-center gap-1.5 {activeModelView === 'split' ? 'bg-indigo-600 text-white font-semibold shadow-xs' : 'text-zinc-400 hover:text-zinc-200'}"
									>
										<Layers class="w-3 h-3" />
										<span>Side-by-Side (Compare)</span>
									</button>
									<button 
										onclick={() => (activeModelView = 'codex')}
										class="px-2.5 py-1 rounded transition flex items-center gap-1.5 {activeModelView === 'codex' ? 'bg-zinc-800 text-emerald-300 font-semibold border border-zinc-700 shadow-xs' : 'text-zinc-400 hover:text-zinc-200'}"
									>
										<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
										<span>Codex</span>
									</button>
									<button 
										onclick={() => (activeModelView = 'deepseek')}
										class="px-2.5 py-1 rounded transition flex items-center gap-1.5 {activeModelView === 'deepseek' ? 'bg-violet-950 text-violet-300 border border-violet-800 font-semibold shadow-xs' : 'text-zinc-400 hover:text-zinc-200'}"
									>
										<span class="w-1.5 h-1.5 rounded-full bg-violet-400"></span>
										<span>DeepSeek R1</span>
									</button>
								</div>
							</div>

							<!-- Quick Tokens Summary -->
							<div class="flex items-center gap-2 text-[11px]">
								<span class="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-emerald-400">
									Codex: {fmt(dualCodex.tokens?.total_tokens)} tok
								</span>
								<span class="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-violet-400">
									DeepSeek: {fmt(dualDeepSeek.tokens?.total_tokens)} tok
								</span>
							</div>
						</div>

						<!-- View: Side-by-Side Split -->
						{#if activeModelView === 'split'}
							{@const dsParsed = extractThoughtAndBody(dualDeepSeek.logs)}
							{@const codexParsed = extractThoughtAndBody(dualCodex.logs)}
							<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 font-sans text-xs">
								<!-- LEFT: Codex Column -->
								<div class="flex flex-col gap-2.5">
									<div class="p-2.5 rounded-t-lg bg-zinc-900 border border-zinc-800 flex items-center justify-between font-mono">
										<div class="flex items-center gap-2">
											<span class="w-2 h-2 rounded-full bg-emerald-400"></span>
											<span class="font-bold text-zinc-100 text-xs">Codex (gpt-6.1-sol)</span>
											<span class="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">{dualCodex.branch}</span>
										</div>
										<span class="text-[11px] text-zinc-400">{fmt(dualCodex.tokens?.total_tokens)} tok</span>
									</div>

									<div class="rounded-b-lg border-x border-b border-zinc-800 bg-zinc-900/40 p-3.5 flex flex-col gap-2">
										<div class="text-zinc-200 whitespace-pre-wrap leading-relaxed font-mono text-xs select-text">
											{codexParsed.body || dualCodex.logs || '(No output recorded)'}
										</div>
									</div>

									{#if dualCodex.diff && dualCodex.diff !== '(No tracked files modified)'}
										<div class="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 font-mono">
											<button 
												onclick={() => (expandCodexDiff = !expandCodexDiff)}
												class="w-full flex items-center justify-between text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
											>
												<span class="font-medium text-emerald-400">Git Diff ({dualCodex.branch})</span>
												<div class="flex items-center gap-1 text-[11px]">
													<span>{expandCodexDiff ? 'Hide Diff' : 'View Diff'}</span>
													<ChevronDown class="w-3.5 h-3.5 {expandCodexDiff ? 'rotate-180' : ''} transition-transform" />
												</div>
											</button>
											{#if expandCodexDiff}
												<pre class="mt-2 text-[11px] text-zinc-300 whitespace-pre-wrap overflow-x-auto max-h-60 p-2 bg-zinc-900/70 rounded border border-zinc-800">{dualCodex.diff}</pre>
											{/if}
										</div>
									{/if}
								</div>

								<!-- RIGHT: DeepSeek R1 Column -->
								<div class="flex flex-col gap-2.5">
									<div class="p-2.5 rounded-t-lg bg-violet-950/60 border border-violet-900/60 flex items-center justify-between font-mono">
										<div class="flex items-center gap-2">
											<span class="w-2 h-2 rounded-full bg-violet-400"></span>
											<span class="font-bold text-violet-200 text-xs">DeepSeek R1 (14b GPU)</span>
											<span class="text-[10px] px-1.5 py-0.2 rounded bg-violet-900/60 text-violet-300">{dualDeepSeek.branch}</span>
										</div>
										<span class="text-[11px] text-violet-300">{fmt(dualDeepSeek.tokens?.total_tokens)} tok</span>
									</div>

									{#if dsParsed.thoughts}
										<div class="rounded-lg border border-violet-900/50 bg-violet-950/25 p-2.5 flex flex-col gap-1.5 font-mono">
											<button 
												onclick={() => (expandThoughts = !expandThoughts)}
												class="flex items-center justify-between text-violet-300 text-xs font-semibold cursor-pointer select-none"
											>
												<div class="flex items-center gap-1.5">
													<Brain class="w-3.5 h-3.5 text-violet-400" />
													<span>Chain of Thought</span>
													<span class="text-[10px] px-1 py-0.2 rounded bg-violet-900/60 text-violet-300">
														{dsParsed.thoughts.length.toLocaleString()} chars
													</span>
												</div>
												<span class="text-[10px] text-violet-400 font-medium">{expandThoughts ? 'Collapse' : 'Expand Thoughts'}</span>
											</button>
											{#if expandThoughts}
												<div class="pt-2 border-t border-violet-900/30 text-violet-200/90 whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto pr-1 text-[11px]">
													{dsParsed.thoughts}
												</div>
											{/if}
										</div>
									{/if}

									<div class="rounded-b-lg border-x border-b border-zinc-800 bg-zinc-900/40 p-3.5 flex flex-col gap-2">
										<div class="text-zinc-200 whitespace-pre-wrap leading-relaxed font-mono text-xs select-text">
											{dsParsed.body || dualDeepSeek.logs || '(No output recorded)'}
										</div>
									</div>

									{#if dualDeepSeek.diff && dualDeepSeek.diff !== '(No files modified)'}
										<div class="rounded-lg border border-violet-900/40 bg-zinc-950 p-2.5 font-mono">
											<button 
												onclick={() => (expandDeepSeekDiff = !expandDeepSeekDiff)}
												class="w-full flex items-center justify-between text-xs text-violet-400 hover:text-violet-200 cursor-pointer"
											>
												<span class="font-medium text-violet-300">Git Diff ({dualDeepSeek.branch})</span>
												<div class="flex items-center gap-1 text-[11px]">
													<span>{expandDeepSeekDiff ? 'Hide Diff' : 'View Diff'}</span>
													<ChevronDown class="w-3.5 h-3.5 {expandDeepSeekDiff ? 'rotate-180' : ''} transition-transform" />
												</div>
											</button>
											{#if expandDeepSeekDiff}
												<pre class="mt-2 text-[11px] text-violet-200 whitespace-pre-wrap overflow-x-auto max-h-60 p-2 bg-zinc-900/70 rounded border border-zinc-800">{dualDeepSeek.diff}</pre>
											{/if}
										</div>
									{/if}
								</div>
							</div>

						<!-- View: Codex Only -->
						{:else if activeModelView === 'codex'}
							<div class="flex flex-col gap-3 font-sans text-xs">
								<div class="p-3 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-between font-mono">
									<div class="flex items-center gap-2">
										<span class="w-2 h-2 rounded-full bg-emerald-400"></span>
										<span class="font-bold text-zinc-100 text-xs">Codex (gpt-6.1-sol)</span>
										<span class="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">{dualCodex.branch}</span>
									</div>
									<span class="text-[11px] text-zinc-400">{fmt(dualCodex.tokens?.total_tokens)} tokens</span>
								</div>

								<div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-2.5">
									<div class="text-zinc-200 whitespace-pre-wrap leading-relaxed font-mono text-xs select-text">
										{extractThoughtAndBody(dualCodex.logs).body || dualCodex.logs}
									</div>
								</div>

								{#if dualCodex.diff}
									<div class="rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono">
										<div class="text-xs font-medium text-emerald-400 mb-2">Git Diff ({dualCodex.branch}):</div>
										<pre class="text-[11px] text-zinc-300 whitespace-pre-wrap overflow-x-auto p-2.5 bg-zinc-900/60 rounded border border-zinc-800">{dualCodex.diff}</pre>
									</div>
								{/if}
							</div>

						<!-- View: DeepSeek R1 Only -->
						{:else if activeModelView === 'deepseek'}
							{@const dsParsed = extractThoughtAndBody(dualDeepSeek.logs)}
							<div class="flex flex-col gap-3 font-sans text-xs">
								<div class="p-3 rounded-lg bg-violet-950/60 border border-violet-900/60 flex items-center justify-between font-mono">
									<div class="flex items-center gap-2">
										<span class="w-2 h-2 rounded-full bg-violet-400"></span>
										<span class="font-bold text-violet-200 text-xs">DeepSeek R1 (14b GPU)</span>
										<span class="text-[10px] px-1.5 py-0.2 rounded bg-violet-900/60 text-violet-300">{dualDeepSeek.branch}</span>
									</div>
									<span class="text-[11px] text-violet-300">{fmt(dualDeepSeek.tokens?.total_tokens)} tokens</span>
								</div>

								{#if dsParsed.thoughts}
									<div class="rounded-lg border border-violet-900/50 bg-violet-950/25 p-3 flex flex-col gap-2 font-mono">
										<button 
											onclick={() => (expandThoughts = !expandThoughts)}
											class="flex items-center justify-between text-violet-300 text-xs font-semibold cursor-pointer select-none"
										>
											<div class="flex items-center gap-2">
												<Brain class="w-4 h-4 text-violet-400" />
												<span>Chain of Thought (กระบวนการคิด)</span>
												<span class="text-[10px] px-1.5 py-0.2 rounded bg-violet-900/60 text-violet-300">
													{dsParsed.thoughts.length.toLocaleString()} chars
												</span>
											</div>
											<span class="text-[11px] text-violet-400 font-medium">{expandThoughts ? 'Collapse' : 'Expand Thoughts'}</span>
										</button>
										{#if expandThoughts}
											<div class="pt-2.5 border-t border-violet-900/30 text-violet-200/90 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto pr-1 text-[11px]">
												{dsParsed.thoughts}
											</div>
										{/if}
									</div>
								{/if}

								<div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-2.5">
									<div class="text-zinc-200 whitespace-pre-wrap leading-relaxed font-mono text-xs select-text">
										{dsParsed.body || dualDeepSeek.logs}
									</div>
								</div>

								{#if dualDeepSeek.diff}
									<div class="rounded-lg border border-violet-900/40 bg-zinc-950 p-3 font-mono">
										<div class="text-xs font-medium text-violet-300 mb-2">Git Diff ({dualDeepSeek.branch}):</div>
										<pre class="text-[11px] text-violet-200 whitespace-pre-wrap overflow-x-auto p-2.5 bg-zinc-900/60 rounded border border-zinc-800">{dualDeepSeek.diff}</pre>
									</div>
								{/if}
							</div>
						{/if}

					<!-- Single Task Mode -->
					{:else}
						{@const logs = singleResult?.logs || ''}
						{@const parsed = extractThoughtAndBody(logs)}
						{@const isDS = singleResult?.provider?.includes('DeepSeek')}
						
						<div class="flex flex-col gap-3 font-sans text-xs">
							<!-- Model Indicator Header -->
							<div class="p-2.5 rounded-lg border {isDS ? 'bg-violet-950/40 border-violet-900/50 text-violet-200' : 'bg-zinc-900 border-zinc-800 text-zinc-200'} flex items-center justify-between font-mono">
								<div class="flex items-center gap-2">
									<span class="w-2 h-2 rounded-full {isDS ? 'bg-violet-400' : 'bg-emerald-400'}"></span>
									<span class="font-bold text-xs">{singleResult?.provider || 'Codex'}</span>
									{#if singleResult?.branch}
										<span class="text-[10px] px-1.5 py-0.2 rounded {isDS ? 'bg-violet-900/60 text-violet-300' : 'bg-zinc-800 text-zinc-400'}">{singleResult.branch}</span>
									{/if}
								</div>
								{#if singleResult?.tokens?.total_tokens}
									<span class="text-[11px] {isDS ? 'text-violet-300' : 'text-zinc-400'}">{fmt(singleResult.tokens.total_tokens)} tokens</span>
								{/if}
							</div>

							<!-- Model Thinking Card (Collapsible) -->
							{#if parsed.thoughts}
								<div class="rounded-lg border border-violet-900/50 bg-violet-950/25 p-3 flex flex-col gap-2 font-mono">
									<button 
										onclick={() => (expandThoughts = !expandThoughts)}
										class="flex items-center justify-between text-violet-300 text-xs font-semibold cursor-pointer select-none"
									>
										<div class="flex items-center gap-2">
											<Brain class="w-4 h-4 text-violet-400" />
											<span>Chain of Thought (กระบวนการคิด)</span>
											<span class="text-[10px] px-1.5 py-0.2 rounded bg-violet-900/60 text-violet-300 border border-violet-800/60 font-mono">
												{parsed.thoughts.length.toLocaleString()} chars
											</span>
										</div>
										<div class="flex items-center gap-1 text-[11px] text-violet-400 font-medium">
											<span>{expandThoughts ? 'Collapse' : 'Expand Thoughts'}</span>
											{#if expandThoughts}
												<ChevronDown class="w-3.5 h-3.5" />
											{:else}
												<ChevronRight class="w-3.5 h-3.5" />
											{/if}
										</div>
									</button>

									{#if expandThoughts}
										<div class="pt-2.5 border-t border-violet-900/30 text-violet-200/90 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto pr-1 selection:bg-violet-500/25 text-[11px]">
											{parsed.thoughts}
										</div>
									{/if}
								</div>
							{/if}

							<!-- Actual Model Response / Output -->
							<div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-2.5">
								<div class="flex items-center justify-between text-xs pb-2 border-b border-zinc-800/80">
									<span class="font-semibold text-zinc-100 flex items-center gap-1.5 font-mono">
										<span class="text-emerald-400">●</span>
										<span>Model Response / คำตอบการวิเคราะห์</span>
									</span>
									{#if singleResult?.diff}
										<button 
											onclick={() => (activeTab = 'diff')}
											class="text-[11px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center gap-1 font-mono transition"
										>
											<span>View Git Diff</span>
											<ChevronRight class="w-3 h-3 text-zinc-400" />
										</button>
									{/if}
								</div>

								{#if parsed.body}
									<div class="text-zinc-200 whitespace-pre-wrap leading-relaxed font-mono text-xs select-text">
										{parsed.body}
									</div>
								{:else}
									<div class="text-zinc-500 italic py-2 font-mono">No response body recorded.</div>
								{/if}
							</div>
						</div>
					{/if}

				<!-- DIFF TAB -->
				{:else if activeTab === 'diff'}
					<pre class="text-zinc-200 whitespace-pre-wrap leading-relaxed">{dualCodex ? dualCodex.diff : (singleResult?.diff || '(No diff recorded)')}</pre>

				<!-- DEEPSEEK DIFF TAB -->
				{:else if activeTab === 'deepseek_diff'}
					<pre class="text-violet-200 whitespace-pre-wrap leading-relaxed">{dualDeepSeek?.diff || '(No diff recorded)'}</pre>

				<!-- RAW LOGS TAB -->
				{:else if activeTab === 'logs'}
					<div class="flex flex-col gap-0.5">
						{#each getFilteredLogLines(getActiveRawLogs()) as item}
							<div class="py-0.5 px-1.5 rounded transition {item.line.includes('exec') ? 'text-cyan-300' : item.line.includes('error') ? 'text-rose-400' : 'text-zinc-300'}">
								{item.line}
							</div>
						{:else}
							<div class="text-zinc-600 italic py-2">No logs found.</div>
						{/each}
					</div>

				<!-- FILES & COMMITS TAB -->
				{:else if activeTab === 'files' && wsDetails}
					<div class="flex flex-col gap-3.5 text-zinc-300">
						<div>
							<div class="text-zinc-500 text-[10px] uppercase tracking-wider mb-1 font-semibold">Commits</div>
							<div class="space-y-1 p-2.5 bg-zinc-900/40 rounded border border-zinc-800/80">
								{#each wsDetails.recentCommits as commit}
									<div class="text-zinc-300 truncate">{commit}</div>
								{/each}
							</div>
						</div>
						<div>
							<div class="text-zinc-500 text-[10px] uppercase tracking-wider mb-1 font-semibold">Files</div>
							<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
								{#each wsDetails.files as file}
									<div class="px-2 py-1 bg-zinc-900/40 rounded border border-zinc-800 text-[11px] truncate text-zinc-400 flex items-center gap-1">
										<FileCode class="w-3 h-3 text-zinc-600 shrink-0" />
										<span class="truncate">{file}</span>
									</div>
								{/each}
							</div>
						</div>
					</div>
				{/if}
			</div>
		</div>

	</main>
</div>

<!-- Clone Modal -->
{#if showCloneModal}
	<div class="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
		<div class="bg-zinc-900 border border-zinc-800 rounded-lg max-w-sm w-full p-5 flex flex-col gap-3 shadow-xl text-xs">
			<div class="flex items-center justify-between">
				<span class="font-semibold text-zinc-200">Clone Repository</span>
				<button onclick={() => (showCloneModal = false)} class="text-zinc-500 hover:text-zinc-300 text-sm">&times;</button>
			</div>

			<div class="flex flex-col gap-2.5">
				<div>
					<label for="clone-url-field" class="text-zinc-400 block mb-1 text-[11px]">Git URL</label>
					<input 
						id="clone-url-field"
						type="text" 
						bind:value={cloneUrl}
						placeholder="https://github.com/..." 
						class="w-full px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-700"
					/>
				</div>
				<div>
					<label for="clone-target-folder" class="text-zinc-400 block mb-1 text-[11px]">Folder (optional)</label>
					<input 
						id="clone-target-folder"
						type="text" 
						bind:value={cloneFolder}
						placeholder="folder-name" 
						class="w-full px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-700"
					/>
				</div>
			</div>

			<div class="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
				<button 
					onclick={() => (showCloneModal = false)} 
					class="px-2.5 py-1 text-zinc-400 hover:text-zinc-200 transition"
				>
					Cancel
				</button>
				<button 
					onclick={handleClone}
					disabled={isCloning}
					class="px-3 py-1 bg-zinc-100 hover:bg-white text-zinc-950 font-medium rounded transition"
				>
					{isCloning ? 'Cloning...' : 'Clone'}
				</button>
			</div>
		</div>
	</div>
{/if}
