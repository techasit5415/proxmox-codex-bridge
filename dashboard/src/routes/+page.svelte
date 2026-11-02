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
		RefreshCw
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

	// State (Svelte 5 Runes) - Zero hardcoded numbers
	let status = $state<SystemStatus | null>(null);
	let workspaces = $state<string[]>([]);
	let activeWs = $state<string>('Android-Tv');
	let wsDetails = $state<WorkspaceDetails | null>(null);

	let prompt = $state<string>('');
	let branch = $state<string>('');
	let isExecuting = $state<boolean>(false);
	let taskBadge = $state<string>('Ready');
	let taskBadgeType = $state<'idle' | 'running' | 'success' | 'error'>('idle');

	let diffResult = $state<string>('');
	let logsResult = $state<string>('');
	let activeTab = $state<'diff' | 'logs' | 'files'>('diff');

	// Real dynamic token stats from server
	let tokenStats = $state<TokenStats | null>(null);

	// Clone Modal
	let showCloneModal = $state<boolean>(false);
	let cloneUrl = $state<string>('');
	let cloneFolder = $state<string>('');
	let isCloning = $state<boolean>(false);

	// Terminal
	let quickCmd = $state<string>('');
	let isRunningCmd = $state<boolean>(false);
	let copied = $state<boolean>(false);

	async function fetchStatus() {
		try {
			const res = await fetch('/api/status');
			if (res.ok) {
				status = await res.json();
				if (status?.tokens) {
					tokenStats = status.tokens;
				}
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

	async function executeTask() {
		if (!prompt.trim() || isExecuting) return;
		isExecuting = true;
		taskBadge = 'Running...';
		taskBadgeType = 'running';

		try {
			const res = await fetch('/api/task', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ workspace: activeWs, prompt, branch })
			});
			const data = await res.json();

			if (data.success) {
				taskBadge = `Done (${data.branch})`;
				taskBadgeType = 'success';
				diffResult = data.diff;
				logsResult = data.logs;
				activeTab = 'diff';
				prompt = '';
				fetchWorkspaceDetails(activeWs);
				fetchStatus();
			} else {
				taskBadge = 'Failed';
				taskBadgeType = 'error';
				logsResult = data.error || 'Execution failed';
				activeTab = 'logs';
			}
		} catch (err: any) {
			taskBadge = 'Error';
			taskBadgeType = 'error';
			logsResult = err.message;
			activeTab = 'logs';
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
		logsResult = `$ ${quickCmd}\n`;

		try {
			const res = await fetch('/api/terminal', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ workspace: activeWs, command: quickCmd })
			});
			const data = await res.json();
			logsResult = `$ ${quickCmd}\n\n` + (data.output || data.error || '(no output)');
			quickCmd = '';
			fetchWorkspaceDetails(activeWs);
		} catch (err: any) {
			logsResult += `\nError: ${err.message}`;
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

	function copyDiff() {
		if (!diffResult) return;
		navigator.clipboard.writeText(diffResult);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	function fmt(n: number | undefined): string {
		if (n === undefined || n === null) return '0';
		return n.toLocaleString();
	}

	onMount(() => {
		fetchStatus();
		fetchWorkspaces();
		const interval = setInterval(fetchStatus, 6000);
		return () => clearInterval(interval);
	});
</script>

<!-- Top Minimal Navbar -->
<header class="border-b border-zinc-800 bg-zinc-950 px-5 py-3 flex items-center justify-between text-xs">
	<div class="flex items-center gap-3">
		<span class="font-bold text-sm tracking-tight text-zinc-100">codex</span>
		<span class="text-zinc-600">/</span>
		<span class="font-mono text-zinc-300 font-medium">{activeWs}</span>
	</div>

	<!-- System & Live Token Stats -->
	<div class="flex items-center gap-3 font-mono text-[11px] text-zinc-400">
		<div class="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300">
			<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
			<span>{status?.codexAuth || 'Checking'}</span>
		</div>

		{#if tokenStats}
			<div class="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300">
				<span class="text-zinc-500">Tokens:</span>
				<strong class="text-zinc-100">{fmt(tokenStats.totalTokens)}</strong>
			</div>
		{/if}

		<div class="hidden md:flex items-center gap-1 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800">
			<span class="text-zinc-500">Disk:</span>
			<span>{status?.diskUsage || '...'}</span>
		</div>

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

		<!-- Task Input Card -->
		<div class="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 flex flex-col gap-3">
			<div class="flex items-center justify-between text-xs">
				<span class="font-medium text-zinc-300">Prompt</span>
				<span class="font-mono text-[11px] text-zinc-500">gpt-6.1-sol &bull; 475k ctx</span>
			</div>

			<textarea 
				bind:value={prompt}
				onkeydown={handleKeydown}
				rows="3"
				placeholder="What should Codex do? (⌘+Enter to execute)"
				class="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-zinc-700 resize-none font-mono placeholder:text-zinc-600 leading-relaxed"
			></textarea>

			<div class="flex items-center justify-between gap-3 pt-0.5">
				<input 
					type="text" 
					bind:value={branch}
					placeholder="Branch: auto (or specify)"
					class="px-2.5 py-1 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-zinc-300 focus:outline-none focus:border-zinc-700 placeholder:text-zinc-600 w-48"
				/>

				<button 
					onclick={executeTask}
					disabled={isExecuting || !prompt.trim()}
					class="px-4 py-1.5 rounded-lg bg-zinc-100 hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 font-semibold text-xs transition flex items-center gap-1.5 cursor-pointer"
				>
					{#if isExecuting}
						<RefreshCw class="w-3 h-3 animate-spin" />
						<span>Executing...</span>
					{:else}
						<Play class="w-3 h-3 fill-current" />
						<span>Execute</span>
					{/if}
				</button>
			</div>
		</div>

		<!-- Live Token Metric Strip (Clean Single Row) -->
		{#if tokenStats}
			<div class="rounded-lg border border-zinc-800 bg-zinc-900/20 px-4 py-2.5 flex items-center justify-between text-[11px] font-mono text-zinc-400 overflow-x-auto gap-4">
				<div class="flex items-center gap-1.5">
					<span class="text-zinc-500">Cumulative:</span>
					<strong class="text-zinc-200">{fmt(tokenStats.totalTokens)}</strong>
				</div>
				<div class="flex items-center gap-1.5">
					<span class="text-zinc-500">Last Task:</span>
					<strong class="text-zinc-200">{fmt(tokenStats.latest?.total_tokens)}</strong>
				</div>
				<div class="flex items-center gap-1.5">
					<span class="text-zinc-500">Cached:</span>
					<span class="text-emerald-400 font-medium">
						{fmt(tokenStats.latest?.cached_input_tokens)} 
						({Math.round(((tokenStats.latest?.cached_input_tokens || 0) / (tokenStats.latest?.input_tokens || 1)) * 100)}%)
					</span>
				</div>
				<div class="flex items-center gap-1.5">
					<span class="text-zinc-500">Output:</span>
					<span class="text-zinc-300">{fmt(tokenStats.latest?.output_tokens)}</span>
				</div>
				<div class="flex items-center gap-1.5 text-zinc-500">
					<span>Sessions:</span>
					<span class="text-zinc-400">{tokenStats.sessionCount}</span>
				</div>
			</div>
		{/if}

		<!-- Results Viewer -->
		<div class="rounded-lg border border-zinc-800 bg-zinc-900/30 flex-1 flex flex-col overflow-hidden min-h-[420px]">
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-zinc-800 px-3 bg-zinc-950">
				<div class="flex items-center">
					<button 
						onclick={() => (activeTab = 'diff')}
						class="px-3.5 py-2.5 text-xs font-medium border-b-2 transition {activeTab === 'diff' ? 'border-zinc-200 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'}"
					>
						Diff
					</button>
					<button 
						onclick={() => (activeTab = 'logs')}
						class="px-3.5 py-2.5 text-xs font-medium border-b-2 transition {activeTab === 'logs' ? 'border-zinc-200 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'}"
					>
						Logs
					</button>
					<button 
						onclick={() => (activeTab = 'files')}
						class="px-3.5 py-2.5 text-xs font-medium border-b-2 transition {activeTab === 'files' ? 'border-zinc-200 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'}"
					>
						Files & Commits
					</button>
				</div>

				<div class="flex items-center gap-3">
					{#if activeTab === 'diff' && diffResult.trim()}
						<button 
							onclick={copyDiff}
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

			<!-- Content Area -->
			<div class="p-3.5 flex-1 overflow-auto bg-zinc-950 font-mono text-xs">
				{#if activeTab === 'diff'}
					<pre class="text-zinc-200 whitespace-pre-wrap leading-relaxed">{diffResult || '(No diff)'}</pre>
				{:else if activeTab === 'logs'}
					<pre class="text-zinc-300 whitespace-pre-wrap leading-relaxed">{logsResult || '(No logs)'}</pre>
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
					<label for="clone-repo-url" class="text-zinc-400 block mb-1 text-[11px]">Git URL</label>
					<input 
						id="clone-repo-url"
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