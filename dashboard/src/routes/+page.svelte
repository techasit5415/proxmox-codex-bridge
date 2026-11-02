<script lang="ts">
	import { onMount } from 'svelte';
	import { 
		Terminal, 
		FolderGit2, 
		Play, 
		GitBranch, 
		FileCode, 
		Cpu, 
		HardDrive, 
		Plus, 
		CheckCircle2, 
		AlertCircle, 
		RefreshCw, 
		ExternalLink, 
		Copy, 
		Check 
	} from 'lucide-svelte';

	interface SystemStatus {
		status: string;
		codexAuth: string;
		diskUsage: string;
		memoryUsage: string;
		nodeVersion: string;
		codexVersion: string;
	}

	interface WorkspaceDetails {
		name: string;
		branch: string;
		status: string;
		recentCommits: string[];
		files: string[];
	}

	// State (Svelte 5 Runes)
	let status = $state<SystemStatus | null>(null);
	let workspaces = $state<string[]>([]);
	let activeWs = $state<string>('demo-project');
	let wsDetails = $state<WorkspaceDetails | null>(null);

	let prompt = $state<string>('');
	let branch = $state<string>('');
	let isExecuting = $state<boolean>(false);
	let taskBadge = $state<string>('Ready');
	let taskBadgeType = $state<'idle' | 'running' | 'success' | 'error'>('idle');

	let diffResult = $state<string>('// Git diff will appear here after task execution...');
	let logsResult = $state<string>('// Agent reasoning logs and test runner stdout will appear here...');
	let activeTab = $state<'diff' | 'logs' | 'files'>('diff');

	// Clone Modal
	let showCloneModal = $state<boolean>(false);
	let cloneUrl = $state<string>('');
	let cloneFolder = $state<string>('');
	let isCloning = $state<boolean>(false);

	// Quick Terminal
	let quickCmd = $state<string>('');
	let isRunningCmd = $state<boolean>(false);
	let copied = $state<boolean>(false);

	async function fetchStatus() {
		try {
			const res = await fetch('/api/status');
			if (res.ok) status = await res.json();
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
		if (!prompt.trim()) return alert('Please enter instructions for Codex');
		isExecuting = true;
		taskBadge = 'Executing in Sandbox...';
		taskBadgeType = 'running';

		try {
			const res = await fetch('/api/task', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ workspace: activeWs, prompt, branch })
			});
			const data = await res.json();

			if (data.success) {
				taskBadge = `Completed (${data.branch})`;
				taskBadgeType = 'success';
				diffResult = data.diff;
				logsResult = data.logs;
				activeTab = 'diff';
				fetchWorkspaceDetails(activeWs);
			} else {
				taskBadge = 'Execution Failed';
				taskBadgeType = 'error';
				logsResult = data.error || 'Unknown error';
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

	async function runTerminalCommand() {
		if (!quickCmd.trim()) return;
		isRunningCmd = true;
		activeTab = 'logs';
		logsResult = `> ${quickCmd}\nRunning in /opt/agent-bridge/workspaces/${activeWs}...\n`;

		try {
			const res = await fetch('/api/terminal', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ workspace: activeWs, command: quickCmd })
			});
			const data = await res.json();
			logsResult = `> ${quickCmd}\n\n` + (data.output || data.error || '(no output)');
		} catch (err: any) {
			logsResult += `\nError: ${err.message}`;
		} finally {
			isRunningCmd = false;
		}
	}

	async function handleClone() {
		if (!cloneUrl.trim()) return alert('Git URL is required');
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
				alert(`Clone failed: ${data.error}`);
			}
		} catch (err: any) {
			alert(`Clone error: ${err.message}`);
		} finally {
			isCloning = false;
		}
	}

	function copyDiff() {
		navigator.clipboard.writeText(diffResult);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	onMount(() => {
		fetchStatus();
		fetchWorkspaces();
		const interval = setInterval(fetchStatus, 10000);
		return () => clearInterval(interval);
	});
</script>

<!-- Top Navbar -->
<header class="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md px-6 py-3.5 flex items-center justify-between">
	<div class="flex items-center space-x-3.5">
		<div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center font-black text-white shadow-lg shadow-indigo-500/25 ring-1 ring-white/20">
			⚡
		</div>
		<div>
			<div class="flex items-center gap-2">
				<h1 class="font-bold text-sm text-zinc-100 tracking-tight">Codex Agent Platform</h1>
				<span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
					<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
					Proxmox CT 24/7
				</span>
			</div>
			<p class="text-[11px] text-zinc-400">SvelteKit &bull; TypeScript &bull; Tailwind &bull; shadcn</p>
		</div>
	</div>

	<!-- System Badges -->
	<div class="flex items-center gap-3 text-xs font-mono">
		<div class="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300">
			<CheckCircle2 class="w-3.5 h-3.5 text-emerald-400" />
			<span>{status?.codexAuth || 'Checking...'}</span>
		</div>
		<div class="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400">
			<HardDrive class="w-3.5 h-3.5 text-zinc-500" />
			<span>Disk: <strong class="text-zinc-200">{status?.diskUsage || '...'}</strong></span>
		</div>
		<div class="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400">
			<Cpu class="w-3.5 h-3.5 text-zinc-500" />
			<span>RAM: <strong class="text-zinc-200">{status?.memoryUsage || '...'}</strong></span>
		</div>
		<a 
			href="https://github.com/techasit5415/proxmox-codex-bridge" 
			target="_blank" 
			rel="noreferrer"
			class="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 transition flex items-center gap-1.5"
		>
			<span>GitHub</span>
			<ExternalLink class="w-3 h-3 text-zinc-500" />
		</a>
	</div>
</header>

<!-- Main Layout -->
<div class="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col lg:flex-row gap-6">

	<!-- Left Sidebar: Workspaces & Quick Cmd -->
	<aside class="w-full lg:w-72 flex flex-col gap-5 shrink-0">
		<!-- Workspaces Card -->
		<div class="rounded-xl border border-zinc-800 bg-zinc-900/40 backdrop-blur p-4 flex flex-col gap-3 shadow-sm">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					<FolderGit2 class="w-4 h-4 text-indigo-400" />
					<h2 class="text-xs font-semibold uppercase tracking-wider text-zinc-400">Workspaces</h2>
				</div>
				<button 
					onclick={() => (showCloneModal = true)}
					class="px-2.5 py-1 text-xs rounded-md bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition flex items-center gap-1 shadow-sm"
				>
					<Plus class="w-3 h-3" />
					<span>Clone</span>
				</button>
			</div>

			<div class="flex flex-col gap-1 max-h-64 overflow-y-auto pr-1">
				{#if workspaces.length === 0}
					<div class="text-xs text-zinc-500 italic py-2">No workspaces found</div>
				{:else}
					{#each workspaces as ws}
						<button 
							onclick={() => selectWorkspace(ws)}
							class="w-full text-left px-3 py-2 rounded-lg text-xs font-mono transition flex items-center justify-between {ws === activeWs ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
						>
							<span class="truncate">{ws}</span>
							{#if ws === activeWs}
								<span class="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
							{/if}
						</button>
					{/each}
				{/if}
			</div>
		</div>

		<!-- Workspace Summary -->
		{#if wsDetails}
			<div class="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-2.5 text-xs">
				<div class="flex items-center gap-1.5 font-semibold text-zinc-300">
					<GitBranch class="w-3.5 h-3.5 text-indigo-400" />
					<span class="font-mono">{wsDetails.branch}</span>
				</div>
				<div class="text-[11px] text-zinc-400">Status: <span class="text-zinc-200 font-mono">{wsDetails.status}</span></div>
				<div class="border-t border-zinc-800/80 pt-2 text-[11px] text-zinc-500">
					Files: <span class="text-zinc-300 font-mono">{wsDetails.files.length} items</span>
				</div>
			</div>
		{/if}

		<!-- Quick Terminal Card -->
		<div class="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-3 shadow-sm">
			<div class="flex items-center gap-2">
				<Terminal class="w-4 h-4 text-emerald-400" />
				<h2 class="text-xs font-semibold uppercase tracking-wider text-zinc-400">Quick Terminal</h2>
			</div>
			<div class="flex flex-col gap-2">
				<input 
					type="text" 
					bind:value={quickCmd}
					placeholder="npm test, git status..."
					onkeydown={(e) => e.key === 'Enter' && runTerminalCommand()}
					class="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 placeholder:text-zinc-600"
				/>
				<button 
					onclick={runTerminalCommand}
					disabled={isRunningCmd}
					class="w-full py-1.5 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-xs font-medium text-zinc-300 transition flex items-center justify-center gap-1.5"
				>
					{#if isRunningCmd}
						<RefreshCw class="w-3 h-3 animate-spin" />
						<span>Executing...</span>
					{:else}
						<span>Run in Workspace</span>
					{/if}
				</button>
			</div>
		</div>
	</aside>

	<!-- Main Execution and Review Area -->
	<main class="flex-1 flex flex-col gap-5 min-w-0">

		<!-- Task Dispatcher Card (shadcn Card) -->
		<div class="rounded-xl border border-zinc-800 bg-zinc-900/50 backdrop-blur p-5 flex flex-col gap-4 shadow-xl">
			<div class="flex items-center justify-between flex-wrap gap-2">
				<div>
					<h3 class="font-bold text-sm text-zinc-100 flex items-center gap-2">
						<span>🚀 Dispatch Autonomous Codex Task</span>
					</h3>
					<p class="text-xs text-zinc-400">Target Workspace: <span class="font-mono text-indigo-400 font-semibold">{activeWs}</span></p>
				</div>
				<div class="flex items-center gap-2">
					<span class="text-[11px] px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 font-medium">
						ChatGPT Plus &bull; gpt-6.1-sol
					</span>
				</div>
			</div>

			<div class="flex flex-col gap-3">
				<textarea 
					bind:value={prompt}
					rows="3"
					placeholder="Describe instructions for Codex (e.g. Create a new REST endpoint /api/users with JWT auth and write unit tests)..."
					class="w-full p-3.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none font-sans leading-relaxed placeholder:text-zinc-600"
				></textarea>

				<div class="flex items-center justify-between flex-wrap gap-2 pt-1">
					<div class="flex items-center gap-2">
						<input 
							type="text" 
							bind:value={branch}
							placeholder="Custom branch name (optional)"
							class="px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-md text-xs font-mono text-zinc-300 focus:outline-none focus:border-indigo-500 placeholder:text-zinc-600 w-56"
						/>
					</div>
					<button 
						onclick={executeTask}
						disabled={isExecuting}
						class="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs shadow-lg shadow-indigo-600/30 transition flex items-center gap-2 cursor-pointer"
					>
						{#if isExecuting}
							<RefreshCw class="w-3.5 h-3.5 animate-spin" />
							<span>Running in Container...</span>
						{:else}
							<Play class="w-3.5 h-3.5 fill-current" />
							<span>Execute with Codex</span>
						{/if}
					</button>
				</div>
			</div>
		</div>

		<!-- Results Viewer Tabs (shadcn Tabs) -->
		<div class="rounded-xl border border-zinc-800 bg-zinc-900/50 flex-1 flex flex-col overflow-hidden shadow-xl min-h-[460px]">
			<!-- Tab Navigation -->
			<div class="flex items-center justify-between border-b border-zinc-800 px-4 bg-zinc-950/60">
				<div class="flex items-center space-x-1">
					<button 
						onclick={() => (activeTab = 'diff')}
						class="px-4 py-3 text-xs font-semibold border-b-2 transition {activeTab === 'diff' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-zinc-400 hover:text-zinc-200'}"
					>
						Git Diff
					</button>
					<button 
						onclick={() => (activeTab = 'logs')}
						class="px-4 py-3 text-xs font-semibold border-b-2 transition {activeTab === 'logs' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-zinc-400 hover:text-zinc-200'}"
					>
						Agent Logs & Tests
					</button>
					<button 
						onclick={() => (activeTab = 'files')}
						class="px-4 py-3 text-xs font-semibold border-b-2 transition {activeTab === 'files' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-zinc-400 hover:text-zinc-200'}"
					>
						Files & History
					</button>
				</div>

				<div class="flex items-center gap-3">
					{#if activeTab === 'diff' && diffResult.trim()}
						<button 
							onclick={copyDiff}
							class="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center gap-1 transition"
						>
							{#if copied}
								<Check class="w-3 h-3 text-emerald-400" />
								<span>Copied</span>
							{:else}
								<Copy class="w-3 h-3" />
								<span>Copy Diff</span>
							{/if}
						</button>
					{/if}
					<span class="text-xs font-mono {taskBadgeType === 'running' ? 'text-amber-400 animate-pulse' : taskBadgeType === 'success' ? 'text-emerald-400' : taskBadgeType === 'error' ? 'text-rose-400' : 'text-zinc-500'}">
						{taskBadge}
					</span>
				</div>
			</div>

			<!-- Tab Content Area -->
			<div class="p-4 flex-1 overflow-auto bg-zinc-950 font-mono text-xs">
				{#if activeTab === 'diff'}
					<pre class="text-emerald-400 whitespace-pre-wrap leading-relaxed selection:bg-emerald-500/20">{diffResult}</pre>
				{:else if activeTab === 'logs'}
					<pre class="text-zinc-300 whitespace-pre-wrap leading-relaxed selection:bg-indigo-500/20">{logsResult}</pre>
				{:else if activeTab === 'files' && wsDetails}
					<div class="flex flex-col gap-4 text-zinc-300">
						<div>
							<div class="text-zinc-500 font-semibold mb-1 uppercase tracking-wider text-[11px]">Recent Commits:</div>
							<div class="space-y-1 p-3 bg-zinc-900/60 rounded-lg border border-zinc-800/80">
								{#each wsDetails.recentCommits as commit}
									<div class="text-zinc-300">{commit}</div>
								{/each}
							</div>
						</div>
						<div>
							<div class="text-zinc-500 font-semibold mb-1 uppercase tracking-wider text-[11px]">Tracked Files:</div>
							<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 p-3 bg-zinc-900/60 rounded-lg border border-zinc-800/80">
								{#each wsDetails.files as file}
									<div class="px-2.5 py-1.5 bg-zinc-950 rounded text-zinc-400 border border-zinc-800 text-[11px] truncate flex items-center gap-1.5">
										<FileCode class="w-3 h-3 text-zinc-500 shrink-0" />
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

<!-- Clone Repository Modal (shadcn Dialog style) -->
{#if showCloneModal}
	<div class="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
		<div class="bg-zinc-900 border border-zinc-800 rounded-xl max-w-md w-full p-6 flex flex-col gap-4 shadow-2xl">
			<div class="flex items-center justify-between">
				<h3 class="font-bold text-sm text-zinc-100 flex items-center gap-2">
					<FolderGit2 class="w-4 h-4 text-indigo-400" />
					<span>Clone Remote Repository</span>
				</h3>
				<button onclick={() => (showCloneModal = false)} class="text-zinc-500 hover:text-zinc-300 text-sm">&times;</button>
			</div>

			<div class="flex flex-col gap-3">
				<div>
					<label for="modal-clone-url" class="text-xs text-zinc-400 block mb-1">Git Clone URL (HTTPS or SSH)</label>
					<input 
						id="modal-clone-url"
						type="text" 
						bind:value={cloneUrl}
						placeholder="https://github.com/user/repo.git" 
						class="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-indigo-500"
					/>
				</div>
				<div>
					<label for="modal-clone-folder" class="text-xs text-zinc-400 block mb-1">Target Folder Name (Optional)</label>
					<input 
						id="modal-clone-folder"
						type="text" 
						bind:value={cloneFolder}
						placeholder="e.g. backend-api" 
						class="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-indigo-500"
					/>
				</div>
			</div>

			<div class="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800/80">
				<button 
					onclick={() => (showCloneModal = false)} 
					class="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition"
				>
					Cancel
				</button>
				<button 
					onclick={handleClone}
					disabled={isCloning}
					class="px-4 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg transition flex items-center gap-1.5 shadow"
				>
					{#if isCloning}
						<RefreshCw class="w-3 h-3 animate-spin" />
						<span>Cloning...</span>
					{:else}
						<span>Clone to Server</span>
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}