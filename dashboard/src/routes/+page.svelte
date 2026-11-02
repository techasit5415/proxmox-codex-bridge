<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import type { 
		SystemStatus, 
		WorkspaceDetails, 
		TaskRecord, 
		TaskResult, 
		TokenStats 
	} from '../lib/types';

	import Header from '../lib/components/Header.svelte';
	import WorkspaceSidebar from '../lib/components/WorkspaceSidebar.svelte';
	import HistorySidebar from '../lib/components/HistorySidebar.svelte';
	import QuickCommand from '../lib/components/QuickCommand.svelte';
	import TaskInput from '../lib/components/TaskInput.svelte';
	import ResultsViewer from '../lib/components/ResultsViewer.svelte';
	import CloneModal from '../lib/components/CloneModal.svelte';

	let { data }: { data: PageData } = $props();

	// Initialize directly from SSR PageData so server-rendered HTML contains all items
	const initWorkspaces = data.workspaces || [];
	const initHistory = data.history || [];

	// State
	let status = $state<SystemStatus | null>(null);
	let workspaces = $state<string[]>(initWorkspaces);
	let activeWs = $state<string>(initWorkspaces[0] || 'Android-Tv');
	let wsDetails = $state<WorkspaceDetails | null>(null);

	// History state
	let history = $state<TaskRecord[]>(initHistory);
	let selectedTaskId = $state<string | null>(null);
	let isLoadingHistory = $state<boolean>(false);

	let prompt = $state<string>('');
	let branch = $state<string>('');
	let provider = $state<'codex' | 'deepseek' | 'both'>('codex');
	let isExecuting = $state<boolean>(false);
	let taskBadge = $state<string>('Ready');
	let taskBadgeType = $state<'idle' | 'running' | 'success' | 'error'>('idle');

	// Execution outputs
	let singleResult = $state<TaskResult | null>(null);
	let dualCodex = $state<TaskResult | null>(null);
	let dualDeepSeek = $state<TaskResult | null>(null);
	let tokenStats = $state<TokenStats | null>(
		initHistory[0]?.tokens
			? {
					totalTokens: initHistory[0].tokens.total_tokens || 0,
					inputTokens: initHistory[0].tokens.input_tokens || 0,
					cachedTokens: initHistory[0].tokens.cached_input_tokens || 0,
					outputTokens: initHistory[0].tokens.output_tokens || 0,
					sessionCount: initHistory.length,
					latest: initHistory[0].tokens
				}
			: null
	);

	// Modal
	let showCloneModal = $state<boolean>(false);
	let isCloning = $state<boolean>(false);

	// Terminal
	let isRunningCmd = $state<boolean>(false);
	let terminalLogs = $state<string>('');


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
				const d = await res.json();
				workspaces = d.workspaces;
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
				const d = await res.json();
				history = d.history || [];
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
			} else {
				provider = 'codex';
			}
		}

		taskBadge = 'Loaded from History';
		taskBadgeType = 'idle';

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
			const d = await res.json();

			if (d.success) {
				taskBadge = 'Completed';
				taskBadgeType = 'success';
				
				if (d.workspace && d.workspace !== activeWs) {
					activeWs = d.workspace;
					await fetchWorkspaces();
				}

				if (d.mode === 'both') {
					dualCodex = d.codex;
					dualDeepSeek = d.deepseek;
					singleResult = null;
				} else {
					singleResult = d;
					dualCodex = null;
					dualDeepSeek = null;
				}

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

	async function runTerminalCommand(quickCmd: string) {
		if (!quickCmd.trim()) return;
		isRunningCmd = true;
		terminalLogs = `$ ${quickCmd}\nRunning in ${activeWs}...\n`;

		try {
			const res = await fetch('/api/terminal', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ workspace: activeWs, command: quickCmd })
			});
			const d = await res.json();
			terminalLogs = `$ ${quickCmd}\n\n` + (d.output || d.error || '(no output)');
			fetchWorkspaceDetails(activeWs);
		} catch (err: any) {
			terminalLogs += `\nError: ${err.message}`;
		} finally {
			isRunningCmd = false;
		}
	}

	async function handleClone(cloneUrl: string, cloneFolder: string) {
		if (!cloneUrl.trim()) return;
		isCloning = true;

		try {
			const res = await fetch('/api/workspaces', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ repoUrl: cloneUrl, folderName: cloneFolder })
			});
			const d = await res.json();
			if (d.success) {
				showCloneModal = false;
				fetchWorkspaces();
			} else {
				alert(d.error);
			}
		} catch (err: any) {
			alert(err.message);
		} finally {
			isCloning = false;
		}
	}

	async function handleDeleteWorkspace(ws: string) {
		if (!confirm(`คุณต้องการลบ Workspace '${ws}' ใช่หรือไม่?`)) {
			return;
		}
		try {
			const res = await fetch(`/api/workspaces/${encodeURIComponent(ws)}`, { 
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' }
			});
			const d = await res.json();
			if (d.success) {
				if (activeWs === ws) {
					activeWs = 'auto-temp';
				}
				await fetchWorkspaces();
			} else {
				alert(d.error || 'ลบ workspace ไม่สำเร็จ');
			}
		} catch (e: any) {
			alert(e.message);
		}
	}

	async function handleCleanTempWorkspaces() {
		if (!confirm('คุณต้องการลบ Temp Workspaces ทั้งหมดใช่หรือไม่?')) {
			return;
		}
		try {
			const res = await fetch('/api/workspaces?tempOnly=true', { 
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' }
			});
			const d = await res.json();
			if (d.success) {
				if (activeWs.startsWith('temp-')) {
					activeWs = 'auto-temp';
				}
				await fetchWorkspaces();
			} else {
				alert(d.error || 'ลบ temp workspaces ไม่สำเร็จ');
			}
		} catch (e: any) {
			alert(e.message);
		}
	}

	onMount(() => {
		if (data.workspaces && data.workspaces.length > 0) {
			workspaces = data.workspaces;
			if (!workspaces.includes(activeWs)) activeWs = data.workspaces[0];
		}
		if (data.history && data.history.length > 0) {
			history = data.history;
		}

		fetchStatus();
		fetchWorkspaces();
		if (activeWs && activeWs !== 'auto-temp') fetchWorkspaceDetails(activeWs);

		const statusInterval = setInterval(() => {
			fetchStatus();
		}, 5000);

		const historyInterval = setInterval(async () => {
			if (!isExecuting) {
				try {
					const res = await fetch('/api/history');
					if (res.ok) {
						const d = await res.json();
						history = d.history || [];
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

<div class="min-h-screen bg-zinc-950 text-zinc-100 antialiased font-sans flex flex-col selection:bg-indigo-500/30 selection:text-indigo-200">
	<!-- Top Navbar -->
	<Header {activeWs} {status} {tokenStats} />

	<!-- Main Workspace Grid -->
	<div class="flex-1 max-w-7xl w-full mx-auto p-5 flex flex-col lg:flex-row gap-5">
		<!-- Left Sidebar -->
		<aside class="w-full lg:w-64 flex flex-col gap-4 shrink-0">
			<WorkspaceSidebar 
				{workspaces} 
				{activeWs} 
				{wsDetails} 
				onSelectWorkspace={selectWorkspace} 
				onOpenClone={() => (showCloneModal = true)} 
				onDeleteWorkspace={handleDeleteWorkspace}
				onCleanTempWorkspaces={handleCleanTempWorkspaces}
			/>

			<HistorySidebar 
				{history} 
				{selectedTaskId} 
				isLoading={isLoadingHistory} 
				onSelectTask={selectHistoryTask} 
				onRefresh={() => fetchHistory(false)} 
			/>

			<QuickCommand 
				{activeWs} 
				onRunCommand={runTerminalCommand} 
				isRunning={isRunningCmd} 
			/>
		</aside>

		<!-- Main Content Area -->
		<main class="flex-1 flex flex-col gap-4 min-w-0">
			<TaskInput 
				bind:prompt 
				bind:branch 
				bind:provider 
				{selectedTaskId} 
				{isExecuting} 
				onExecute={executeTask} 
				onClearSelected={clearSelectedTask} 
			/>

			<ResultsViewer 
				{singleResult} 
				{dualCodex} 
				{dualDeepSeek} 
				{wsDetails} 
				{terminalLogs} 
				{taskBadge} 
				{taskBadgeType} 
			/>
		</main>
	</div>

	<!-- Clone Repository Modal -->
	<CloneModal 
		open={showCloneModal} 
		onClose={() => (showCloneModal = false)} 
		onClone={handleClone} 
		{isCloning} 
	/>
</div>
