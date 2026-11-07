<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import type { 
		SystemStatus, 
		WorkspaceDetails, 
		TaskRecord, 
		TaskResult, 
		ConsensusData,
		TokenStats,
		AIModelConfig,
		TaskJobData
	} from '../lib/types';

	import Header from '../lib/components/Header.svelte';
	import WorkspaceSidebar from '../lib/components/WorkspaceSidebar.svelte';
	import HistorySidebar from '../lib/components/HistorySidebar.svelte';
	import QuickCommand from '../lib/components/QuickCommand.svelte';
	import TaskInput from '../lib/components/TaskInput.svelte';
	import ResultsViewer from '../lib/components/ResultsViewer.svelte';
	import CloneModal from '../lib/components/CloneModal.svelte';
	import SettingsModal from '../lib/components/SettingsModal.svelte';
	import QueueModal from '../lib/components/QueueModal.svelte';

	let { data }: { data: PageData } = $props();

	// State: Default to 'all' (Unselected / Auto-Temp mode) — NEVER auto-select first workspace on refresh!
	let status = $state<SystemStatus | null>(null);
	let workspaces = $state<string[]>(data.workspaces || []);
	let activeWs = $state<string>('all');
	let wsDetails = $state<WorkspaceDetails | null>(null);
	let models = $state<AIModelConfig[]>([]);
	let showSettingsModal = $state<boolean>(false);
	let showQueueModal = $state<boolean>(false);
	let currentEventSource: EventSource | null = null;

	// History state
	let history = $state<TaskRecord[]>(data.history || []);
	let selectedTaskId = $state<string | null>(null);
	let isLoadingHistory = $state<boolean>(false);

	let prompt = $state<string>('');
	let branch = $state<string>('');
	let provider = $state<'codex' | 'deepseek' | 'both' | 'consensus'>('codex');
	let isExecuting = $state<boolean>(false);
	let taskBadge = $state<string>('Ready');
	let taskBadgeType = $state<'idle' | 'running' | 'success' | 'error'>('idle');

	// Execution outputs
	let singleResult = $state<TaskResult | null>(null);
	let dualCodex = $state<TaskResult | null>(null);
	let dualDeepSeek = $state<TaskResult | null>(null);
	let consensusResult = $state<ConsensusData | null>(null);
	let tokenStats = $state<TokenStats | null>(null);

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
				workspaces = d.workspaces || [];
				// Only reset to 'all' if a specific workspace was selected and later deleted;
				// NEVER force workspaces[0] ('Android-Tv') when activeWs is 'all' or 'auto-temp'!
				if (activeWs !== 'all' && activeWs !== 'auto-temp' && !workspaces.includes(activeWs)) {
					activeWs = 'all';
					wsDetails = null;
				} else if (activeWs && activeWs !== 'all' && activeWs !== 'auto-temp') {
					fetchWorkspaceDetails(activeWs);
				}
			}
		} catch (e) {
			console.error(e);
		}
	}

	async function fetchWorkspaceDetails(name: string) {
		if (!name || name === 'all' || name === 'auto-temp') {
			wsDetails = null;
			return;
		}
		try {
			const res = await fetch(`/api/workspaces/${encodeURIComponent(name)}`);
			if (res.ok) wsDetails = await res.json();
		} catch (e) {
			console.error(e);
		}
	}

	async function fetchModels() {
		try {
			const res = await fetch('/api/models');
			if (res.ok) {
				const d = await res.json();
				models = d.models || [];
			}
		} catch (e) {
			console.error('Failed to fetch models:', e);
		}
	}

	function selectWorkspace(ws: string) {
		// Toggle: clicking the active workspace again deselects it back to 'all'
		if (activeWs === ws && ws !== 'all') {
			activeWs = 'all';
			wsDetails = null;
			return;
		}

		activeWs = ws;
		if (ws && ws !== 'all' && ws !== 'auto-temp') {
			fetchWorkspaceDetails(ws);
		} else {
			wsDetails = null;
		}
	}

	function handleApplyStarter(starterPrompt: string, starterProvider: 'codex' | 'deepseek' | 'both' | 'consensus') {
		selectedTaskId = null;
		prompt = starterPrompt;
		provider = starterProvider;
	}

	async function fetchHistory(autoSelectLatest = false) {
		isLoadingHistory = true;
		try {
			const res = await fetch('/api/history?summary=true');
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

	async function selectHistoryTask(item: TaskRecord) {
		selectedTaskId = item.id;
		prompt = item.prompt || '';
		branch = item.branch || '';
		
		if (item.workspace && workspaces.includes(item.workspace) && !item.workspace.startsWith('temp-')) {
			fetchWorkspaceDetails(item.workspace);
		}

		let fullItem = item;
		// If task was loaded as summary (no logs/diff/codex/consensus), fetch full task details
		if (!item.logs && !item.diff && !item.codex && !item.consensus) {
			try {
				const res = await fetch(`/api/history?id=${encodeURIComponent(item.id)}`);
				if (res.ok) {
					const d = await res.json();
					if (d.task) {
						fullItem = d.task;
						const idx = history.findIndex((h) => h.id === item.id);
						if (idx !== -1) history[idx] = fullItem;
					}
				}
			} catch (e) {
				console.error('Failed to load task details:', e);
			}
		}

		if (fullItem.mode === 'consensus' && fullItem.consensus) {
			consensusResult = fullItem.consensus;
			dualCodex = null;
			dualDeepSeek = null;
			singleResult = null;
			provider = 'consensus';
		} else if (fullItem.mode === 'both' && fullItem.codex && fullItem.deepseek) {
			dualCodex = fullItem.codex;
			dualDeepSeek = fullItem.deepseek;
			consensusResult = null;
			singleResult = null;
			provider = 'both';
		} else {
			singleResult = {
				provider: fullItem.provider,
				branch: fullItem.branch,
				status: fullItem.status,
				diff: fullItem.diff || '',
				logs: fullItem.logs || '',
				tokens: fullItem.tokens
			};
			dualCodex = null;
			dualDeepSeek = null;
			consensusResult = null;
			if (fullItem.provider?.includes('DeepSeek')) {
				provider = 'deepseek';
			} else {
				provider = 'codex';
			}
		}

		taskBadge = 'Loaded from History';
		taskBadgeType = 'idle';

		if (fullItem.tokens) {
			const tot = fullItem.tokens.total_tokens || 0;
			const cached = fullItem.tokens.cached_input_tokens || 0;
			tokenStats = {
				totalTokens: tot,
				netTokens: fullItem.tokens.net_tokens ?? Math.max(0, tot - cached),
				inputTokens: fullItem.tokens.input_tokens || 0,
				cachedTokens: cached,
				outputTokens: fullItem.tokens.output_tokens || 0,
				sessionCount: history.length,
				latest: fullItem.tokens
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
		consensusResult = null;
		terminalLogs = '';
		taskBadge = 'Ready';
		taskBadgeType = 'idle';
		fetchStatus();
	}

	function attachLiveJobStream(taskId: string, initialBadge = 'Queued in Redis Job Queue...') {
		if (currentEventSource) {
			currentEventSource.close();
			currentEventSource = null;
		}
		isExecuting = true;
		taskBadge = initialBadge;
		taskBadgeType = 'running';

		const eventSource = new EventSource('/api/task/' + taskId + '/events');
		currentEventSource = eventSource;

		eventSource.onmessage = async (e) => {
			try {
				const event = JSON.parse(e.data);
				if (event.type === 'status') {
					taskBadge = event.status === 'queued' ? 'Queued in Redis...' : 'Running on Proxmox...';
					fetchStatus();
				} else if (event.type === 'stage') {
					taskBadge = event.stage;
					fetchStatus();
				} else if (event.type === 'done') {
					eventSource.close();
					if (currentEventSource === eventSource) currentEventSource = null;
					taskBadge = 'Completed';
					taskBadgeType = 'success';
					isExecuting = false;

					const result = event.result || {};
					await fetchWorkspaces();

					if (result.mode === 'consensus') {
						consensusResult = result.consensus;
						dualCodex = null;
						dualDeepSeek = null;
						singleResult = null;
					} else if (result.mode === 'both') {
						dualCodex = result.codex;
						dualDeepSeek = result.deepseek;
						consensusResult = null;
						singleResult = null;
					} else {
						singleResult = result;
						dualCodex = null;
						dualDeepSeek = null;
						consensusResult = null;
					}

					if (activeWs && activeWs !== 'all' && activeWs !== 'auto-temp') {
						fetchWorkspaceDetails(activeWs);
					}
					fetchStatus();
					await fetchHistory(false);
				} else if (event.type === 'error') {
					eventSource.close();
					if (currentEventSource === eventSource) currentEventSource = null;
					taskBadge = 'Failed: ' + (event.error || 'Execution error');
					taskBadgeType = 'error';
					isExecuting = false;
					fetchStatus();
				}
			} catch (parseErr) {
				console.error('SSE Parse Error:', parseErr);
			}
		};

		eventSource.onerror = () => {
			eventSource.close();
			if (currentEventSource === eventSource) currentEventSource = null;
			setTimeout(async () => {
				await fetchHistory(true);
				fetchStatus();
				isExecuting = false;
				taskBadge = 'Completed';
				taskBadgeType = 'success';
			}, 1500);
		};
	}

	function handleWatchJob(job: TaskJobData) {
		selectedTaskId = null;
		prompt = job.prompt || '';
		const p = (job.provider || '').toLowerCase();
		if (p.includes('consensus')) provider = 'consensus';
		else if (p === 'both' || p.includes('dual')) provider = 'both';
		else if (p.includes('deepseek')) provider = 'deepseek';
		else provider = 'codex';

		attachLiveJobStream(job.id, job.stage || 'กำลังประมวลผลบน Proxmox...');
	}

	async function handleCancelQueueJob(taskId: string) {
		try {
			const res = await fetch(`/api/task/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
			const d = await res.json();
			if (!d.success) {
				alert(d.error || 'ไม่สามารถยกเลิกคิวได้');
			}
			await fetchStatus();
		} catch (e: any) {
			alert(e.message);
		}
	}

	async function executeTask() {
		if (!prompt.trim() || isExecuting) return;
		isExecuting = true;
		selectedTaskId = null;
		taskBadge = provider === 'consensus'
			? 'Running Multi-Agent Consensus Loop...'
			: (provider === 'both' ? 'Running Dual Agents (Worktrees)...' : 'Executing...');
		taskBadgeType = 'running';

		try {
			const targetWs = (activeWs === 'all' || !activeWs) ? 'auto-temp' : activeWs;
			const res = await fetch('/api/task', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ workspace: targetWs, prompt, branch, provider })
			});
			const d = await res.json();

			if (res.status === 202 && d.taskId) {
				// Immediately refresh status so Queue badge & History top card appear with 0ms delay!
				fetchStatus();
				attachLiveJobStream(d.taskId, 'Queued in Redis Job Queue...');
				return;
			}

			if (d.success) {
				taskBadge = 'Completed';
				taskBadgeType = 'success';
				await fetchWorkspaces();

				if (d.mode === 'consensus') {
					consensusResult = d.consensus;
					dualCodex = null;
					dualDeepSeek = null;
					singleResult = null;
				} else if (d.mode === 'both') {
					dualCodex = d.codex;
					dualDeepSeek = d.deepseek;
					consensusResult = null;
					singleResult = null;
				} else {
					singleResult = d;
					dualCodex = null;
					dualDeepSeek = null;
					consensusResult = null;
				}

				if (activeWs && activeWs !== 'all' && activeWs !== 'auto-temp') {
					fetchWorkspaceDetails(activeWs);
				}
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
		const targetWs = (activeWs === 'all' || activeWs === 'auto-temp' || !activeWs)
			? (workspaces.find(w => !w.startsWith('temp-')) || 'demo-project')
			: activeWs;
		terminalLogs = `$ ${quickCmd}\nRunning in ${targetWs}...\n`;

		try {
			const res = await fetch('/api/terminal', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ workspace: targetWs, command: quickCmd })
			});
			const d = await res.json();
			terminalLogs = `$ ${quickCmd} (in ${targetWs})\n\n` + (d.output || d.error || '(no output)');
			if (activeWs && activeWs !== 'all' && activeWs !== 'auto-temp') {
				fetchWorkspaceDetails(activeWs);
			}
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
					activeWs = 'all';
					wsDetails = null;
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
					activeWs = 'all';
					wsDetails = null;
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
			// Keep activeWs = 'all' (Unselected / Auto-Temp) on page load & refresh!
		}
		if (data.history && data.history.length > 0) {
			history = data.history;
			if (data.history[0]?.tokens) {
				const tot = data.history[0].tokens.total_tokens || 0;
				const cached = data.history[0].tokens.cached_input_tokens || 0;
				tokenStats = {
					totalTokens: tot,
					netTokens: data.history[0].tokens.net_tokens ?? Math.max(0, tot - cached),
					inputTokens: data.history[0].tokens.input_tokens || 0,
					cachedTokens: cached,
					outputTokens: data.history[0].tokens.output_tokens || 0,
					sessionCount: data.history.length,
					latest: data.history[0].tokens
				};
			}
		}

		fetchStatus();
		fetchWorkspaces();
		fetchModels();

		const statusInterval = setInterval(() => {
			fetchStatus();
		}, 2500);

		const historyInterval = setInterval(async () => {
			try {
				const res = await fetch('/api/history?summary=true');
				if (res.ok) {
					const d = await res.json();
					history = d.history || [];
				}
			} catch (e) {}
		}, 3000);

		return () => {
			clearInterval(statusInterval);
			clearInterval(historyInterval);
			if (currentEventSource) currentEventSource.close();
		};
	});
</script>

<div class="min-h-screen bg-zinc-950 text-zinc-100 antialiased font-sans flex flex-col selection:bg-indigo-500/30 selection:text-indigo-200">
	<!-- Top Navbar -->
	<Header 
		activeWs={activeWs === 'all' || activeWs === 'auto-temp' ? 'global' : activeWs} 
		{status} 
		{tokenStats} 
		onOpenSettings={() => (showSettingsModal = true)}
		onOpenQueue={() => (showQueueModal = true)}
	/>

	<!-- Main Workspace Grid -->
	<div class="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-5 flex flex-col lg:flex-row gap-5">
		<!-- Left Sidebar -->
		<aside class="w-full lg:w-72 flex flex-col gap-3.5 shrink-0">
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
				activeJobs={status?.activeJobs || []}
				{selectedTaskId} 
				isLoading={isLoadingHistory} 
				{activeWs}
				onSelectTask={selectHistoryTask} 
				onRefresh={() => { fetchHistory(false); fetchStatus(); }} 
				onClearWorkspaceFilter={() => selectWorkspace('all')}
				onNewTask={clearSelectedTask}
				onOpenQueue={() => (showQueueModal = true)}
				onWatchJob={handleWatchJob}
			/>

			<QuickCommand 
				activeWs={activeWs === 'all' || activeWs === 'auto-temp' ? (workspaces.find(w => !w.startsWith('temp-')) || 'demo-project') : activeWs} 
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
				{activeWs}
				{workspaces}
				{models}
				{selectedTaskId} 
				{isExecuting} 
				onExecute={executeTask} 
				onClearSelected={clearSelectedTask}
				onSelectWorkspace={selectWorkspace}
			/>

			<ResultsViewer 
				{singleResult} 
				{dualCodex} 
				{dualDeepSeek} 
				{consensusResult}
				{wsDetails} 
				{terminalLogs} 
				{taskBadge} 
				{taskBadgeType}
				recentHistory={history}
				onApplyStarter={handleApplyStarter}
				onSelectHistoryTask={selectHistoryTask}
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

	<!-- AI Models & API Settings Modal -->
	<SettingsModal 
		isOpen={showSettingsModal} 
		{models} 
		onClose={() => (showSettingsModal = false)} 
		onModelsUpdated={fetchModels} 
	/>

	<!-- Live Queue Inspector Modal -->
	<QueueModal
		isOpen={showQueueModal}
		activeJobs={status?.activeJobs || []}
		redisStatus={status?.redisStatus}
		onClose={() => (showQueueModal = false)}
		onRefresh={fetchStatus}
		onWatchJob={handleWatchJob}
		onCancelJob={handleCancelQueueJob}
	/>
</div>
