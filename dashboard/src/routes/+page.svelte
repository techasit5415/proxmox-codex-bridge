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
		AIModelConfig
	} from '../lib/types';

	import Header from '../lib/components/Header.svelte';
	import WorkspaceSidebar from '../lib/components/WorkspaceSidebar.svelte';
	import HistorySidebar from '../lib/components/HistorySidebar.svelte';
	import QuickCommand from '../lib/components/QuickCommand.svelte';
	import TaskInput from '../lib/components/TaskInput.svelte';
	import ResultsViewer from '../lib/components/ResultsViewer.svelte';
	import CloneModal from '../lib/components/CloneModal.svelte';
	import SettingsModal from '../lib/components/SettingsModal.svelte';

	let { data }: { data: PageData } = $props();

	// State
	let status = $state<SystemStatus | null>(null);
	let workspaces = $state<string[]>(data.workspaces || []);
	let activeWs = $state<string>('all');
	let wsDetails = $state<WorkspaceDetails | null>(null);
	let models = $state<AIModelConfig[]>([]);
	let showSettingsModal = $state<boolean>(false);

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
		
		if (item.workspace && workspaces.includes(item.workspace)) {
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
			tokenStats = {
				totalTokens: fullItem.tokens.total_tokens || 0,
				inputTokens: fullItem.tokens.input_tokens || 0,
				cachedTokens: fullItem.tokens.cached_input_tokens || 0,
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
		taskBadge = 'Ready';
		taskBadgeType = 'idle';
		fetchStatus();
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
				taskBadge = 'Queued in Redis Job Queue...';
				taskBadgeType = 'running';

				const eventSource = new EventSource('/api/task/' + d.taskId + '/events');

				eventSource.onmessage = async (e) => {
					try {
						const event = JSON.parse(e.data);
						if (event.type === 'status') {
							taskBadge = event.status === 'queued' ? 'Queued in Redis...' : 'Running on Proxmox...';
						} else if (event.type === 'stage') {
							taskBadge = event.stage;
						} else if (event.type === 'done') {
							eventSource.close();
							taskBadge = 'Completed';
							taskBadgeType = 'success';
							isExecuting = false;

							const result = event.result || {};
							if (result.workspace && activeWs !== 'all' && result.workspace !== activeWs) {
								activeWs = result.workspace;
								await fetchWorkspaces();
							}

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

							fetchWorkspaceDetails(activeWs);
							fetchStatus();
							await fetchHistory(false);
						} else if (event.type === 'error') {
							eventSource.close();
							taskBadge = 'Failed: ' + (event.error || 'Execution error');
							taskBadgeType = 'error';
							isExecuting = false;
						}
					} catch (parseErr) {
						console.error('SSE Parse Error:', parseErr);
					}
				};

				eventSource.onerror = () => {
					eventSource.close();
					setTimeout(async () => {
						await fetchHistory(true);
						isExecuting = false;
						taskBadge = 'Completed';
						taskBadgeType = 'success';
					}, 2000);
				};
				return;
			}

			if (d.success) {
				taskBadge = 'Completed';
				taskBadgeType = 'success';
				
				if (d.workspace && activeWs !== 'all' && d.workspace !== activeWs) {
					activeWs = d.workspace;
					await fetchWorkspaces();
				}

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
			if (data.history[0]?.tokens) {
				tokenStats = {
					totalTokens: data.history[0].tokens.total_tokens || 0,
					inputTokens: data.history[0].tokens.input_tokens || 0,
					cachedTokens: data.history[0].tokens.cached_input_tokens || 0,
					outputTokens: data.history[0].tokens.output_tokens || 0,
					sessionCount: data.history.length,
					latest: data.history[0].tokens
				};
			}
		}

		fetchStatus();
		fetchWorkspaces();
		fetchModels();
		if (activeWs && activeWs !== 'auto-temp') fetchWorkspaceDetails(activeWs);

		const statusInterval = setInterval(() => {
			fetchStatus();
		}, 5000);

		const historyInterval = setInterval(async () => {
			if (!isExecuting) {
				try {
					const res = await fetch('/api/history?summary=true');
					if (res.ok) {
						const d = await res.json();
						history = d.history || [];
					}
				} catch (e) {}
			}
		}, 5000);

		return () => {
			clearInterval(statusInterval);
			clearInterval(historyInterval);
		};
	});
</script>

<div class="min-h-screen bg-zinc-950 text-zinc-100 antialiased font-sans flex flex-col selection:bg-indigo-500/30 selection:text-indigo-200">
	<!-- Top Navbar -->
	<Header 
		activeWs={activeWs === 'all' ? 'ทุกโปรเจกต์ (All)' : activeWs} 
		{status} 
		{tokenStats} 
		onOpenSettings={() => (showSettingsModal = true)}
	/>

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
				{activeWs}
				onSelectTask={selectHistoryTask} 
				onRefresh={() => fetchHistory(false)} 
				onClearWorkspaceFilter={() => selectWorkspace('all')}
			/>

			<QuickCommand 
				activeWs={activeWs === 'all' ? (workspaces.find(w => !w.startsWith('temp-')) || 'demo-project') : activeWs} 
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
				{models}
				{selectedTaskId} 
				{isExecuting} 
				onExecute={executeTask} 
				onClearSelected={clearSelectedTask} 
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
</div>
