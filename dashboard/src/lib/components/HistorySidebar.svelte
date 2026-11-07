<script lang="ts">
	import { History, RotateCcw, Search, Plus, RefreshCw, Clock, Layers, Folder, Terminal, X } from 'lucide-svelte';
	import type { TaskRecord, TaskJobData } from '../types';
	import { fmtTokens, getNetTokens } from '../types';

	interface Props {
		history: TaskRecord[];
		activeJobs?: TaskJobData[];
		selectedTaskId: string | null;
		isLoading: boolean;
		activeWs?: string;
		onSelectTask: (item: TaskRecord) => void;
		onRefresh: () => void;
		onClearWorkspaceFilter?: () => void;
		onNewTask?: () => void;
		onOpenQueue?: () => void;
		onWatchJob?: (job: TaskJobData) => void;
	}

	let { 
		history, 
		activeJobs = [],
		selectedTaskId, 
		isLoading, 
		activeWs = 'all',
		onSelectTask, 
		onRefresh,
		onClearWorkspaceFilter,
		onNewTask,
		onOpenQueue,
		onWatchJob
	}: Props = $props();

	let historyFilter = $state<'all' | 'codex' | 'deepseek' | 'both' | 'consensus'>('all');
	let searchQuery = $state<string>('');

	// Step 1: Filter by Workspace if a specific project/temp folder is selected
	let workspaceFilteredHistory = $derived.by(() => {
		if (!activeWs || activeWs === 'all' || activeWs === 'auto-temp') return history;
		return history.filter(h => h.workspace === activeWs);
	});

	// Filter active jobs by current filter if applicable
	let filteredActiveJobs = $derived.by(() => {
		let jobs = activeJobs;
		if (activeWs && activeWs !== 'all' && activeWs !== 'auto-temp') {
			jobs = jobs.filter(j => j.workspace === activeWs);
		}
		if (historyFilter !== 'all') {
			jobs = jobs.filter(j => {
				const p = (j.provider || '').toLowerCase();
				if (historyFilter === 'consensus') return p.includes('consensus');
				if (historyFilter === 'both') return p === 'both' || p.includes('dual');
				if (historyFilter === 'deepseek') return p.includes('deepseek');
				if (historyFilter === 'codex') return p.includes('codex');
				return true;
			});
		}
		const q = searchQuery.trim().toLowerCase();
		if (q) {
			jobs = jobs.filter(j =>
				(j.prompt || '').toLowerCase().includes(q) ||
				(j.workspace || '').toLowerCase().includes(q)
			);
		}
		return jobs;
	});

	// Step 2: Filter by Model / Mode pills + Search query
	let filteredHistory = $derived.by(() => {
		let base = workspaceFilteredHistory;
		if (historyFilter === 'consensus') {
			base = base.filter(h => h.mode === 'consensus' || h.provider?.includes('Consensus'));
		} else if (historyFilter === 'codex') {
			base = base.filter(h => h.mode !== 'both' && h.mode !== 'consensus' && !h.provider?.includes('Dual') && !h.provider?.includes('Consensus') && (h.provider?.includes('Codex') || !h.provider?.includes('DeepSeek')));
		} else if (historyFilter === 'deepseek') {
			base = base.filter(h => h.mode !== 'both' && h.mode !== 'consensus' && !h.provider?.includes('Dual') && !h.provider?.includes('Consensus') && h.provider?.includes('DeepSeek'));
		} else if (historyFilter === 'both') {
			base = base.filter(h => h.mode === 'both' || h.provider?.includes('Dual'));
		}

		const q = searchQuery.trim().toLowerCase();
		if (q) {
			base = base.filter(h =>
				(h.prompt || '').toLowerCase().includes(q) ||
				(h.workspace || '').toLowerCase().includes(q) ||
				(h.provider || '').toLowerCase().includes(q)
			);
		}
		return base;
	});

	function countHistory(type: 'codex' | 'deepseek' | 'both' | 'consensus'): number {
		const base = workspaceFilteredHistory;
		if (type === 'consensus') return base.filter(h => h.mode === 'consensus' || h.provider?.includes('Consensus')).length;
		if (type === 'codex') return base.filter(h => h.mode !== 'both' && h.mode !== 'consensus' && !h.provider?.includes('Dual') && !h.provider?.includes('Consensus') && (h.provider?.includes('Codex') || !h.provider?.includes('DeepSeek'))).length;
		if (type === 'deepseek') return base.filter(h => h.mode !== 'both' && h.mode !== 'consensus' && !h.provider?.includes('Dual') && !h.provider?.includes('Consensus') && h.provider?.includes('DeepSeek')).length;
		if (type === 'both') return base.filter(h => h.mode === 'both' || h.provider?.includes('Dual')).length;
		return 0;
	}

	function getBadgeInfo(item: TaskRecord) {
		if (item.mode === 'consensus' || item.provider?.includes('Consensus')) {
			return { label: 'Consensus', class: 'bg-zinc-800 text-amber-300 border border-zinc-700' };
		}
		if (item.mode === 'both' || item.provider?.includes('Dual')) {
			return { label: 'Compare', class: 'bg-zinc-800 text-indigo-300 border border-zinc-700' };
		}
		if (item.provider?.includes('DeepSeek')) {
			return { label: 'DeepSeek R1', class: 'bg-zinc-800 text-violet-300 border border-zinc-700' };
		}
		return { label: 'Codex', class: 'bg-zinc-800 text-emerald-300 border border-zinc-700' };
	}

	function getActiveJobBadge(provider: string) {
		const p = (provider || '').toLowerCase();
		if (p.includes('consensus')) return 'Consensus';
		if (p === 'both' || p.includes('dual')) return 'Compare';
		if (p.includes('deepseek')) return 'DeepSeek R1';
		return 'Codex';
	}

	function formatWorkspaceLabel(ws?: string): string {
		if (!ws || ws === 'auto-temp' || ws === 'temp' || ws === 'all') return 'Auto Temp';
		if (ws.startsWith('temp-')) {
			return ws.replace(/^temp-/, '').replace(/-[a-z0-9]{4}$/i, '');
		}
		return ws;
	}

	function formatTime(ts: number): string {
		if (!ts) return '';
		const d = new Date(ts);
		const isToday = new Date().toDateString() === d.toDateString();
		const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		if (isToday) return timeStr;
		return `${d.getMonth() + 1}/${d.getDate()} ${timeStr}`;
	}
</script>

<div class="rounded-xl border border-zinc-800/90 bg-zinc-900/40 p-3 flex flex-col gap-2.5 shadow-sm flex-1 min-h-0">
	<!-- Header -->
	<div class="flex items-center justify-between text-xs px-0.5">
		<div class="flex items-center gap-1.5 text-zinc-200 font-medium overflow-hidden">
			<History class="size-3.5 text-zinc-400 shrink-0" strokeWidth={1.5} />
			<span class="shrink-0">History</span>
			{#if activeWs && activeWs !== 'all' && activeWs !== 'auto-temp'}
				<div class="flex items-center gap-1 text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 font-mono truncate max-w-[100px]">
					<span class="truncate">{activeWs}</span>
					{#if onClearWorkspaceFilter}
						<button 
							onclick={onClearWorkspaceFilter}
							title="Clear workspace filter"
							class="text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer shrink-0"
						>
							<X class="size-2.5" />
						</button>
					{/if}
				</div>
			{/if}
			<span class="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 font-mono shrink-0">
				{filteredHistory.length + filteredActiveJobs.length}
			</span>
		</div>

		<div class="flex items-center gap-1">
			{#if activeJobs.length > 0 && onOpenQueue}
				<button
					onclick={onOpenQueue}
					class="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/60 hover:bg-amber-900/60 text-amber-200 border border-amber-800/60 transition-colors flex items-center gap-1 cursor-pointer font-mono"
					title="View active job queue"
				>
					<Layers class="size-2.5 text-amber-400" strokeWidth={1.5} />
					<span>Queue ({activeJobs.length})</span>
				</button>
			{/if}
			{#if selectedTaskId && onNewTask}
				<button
					onclick={onNewTask}
					class="text-[10px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors flex items-center gap-1 cursor-pointer font-medium"
					title="Start a new task"
				>
					<Plus class="size-2.5" strokeWidth={1.5} />
					<span>New</span>
				</button>
			{/if}
			<button 
				onclick={onRefresh}
				title="Refresh history"
				class="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
			>
				<RotateCcw class="size-3 text-zinc-400 {isLoading ? 'animate-spin' : ''}" strokeWidth={1.5} />
			</button>
		</div>
	</div>

	<!-- Search Input -->
	<div class="relative">
		<Search class="size-3 absolute left-2.5 top-2 text-zinc-500" strokeWidth={1.5} />
		<input
			type="text"
			bind:value={searchQuery}
			placeholder="Search history..."
			class="w-full pl-7 pr-6 py-1 bg-zinc-950 border border-zinc-800 rounded-md text-[11px] text-zinc-200 focus:outline-none focus:border-zinc-700 placeholder:text-zinc-600"
		/>
		{#if searchQuery}
			<button
				onclick={() => (searchQuery = '')}
				class="absolute right-2 top-1 text-zinc-500 hover:text-zinc-300 text-xs cursor-pointer"
			>&times;</button>
		{/if}
	</div>

	<!-- Quick Filter Tabs -->
	<div class="grid grid-cols-5 gap-0.5 p-0.5 bg-zinc-950 rounded-md border border-zinc-800 text-[10px] font-mono">
		<button 
			onclick={() => (historyFilter = 'all')}
			class="py-0.5 rounded transition-colors text-center cursor-pointer {historyFilter === 'all' ? 'bg-zinc-800 text-zinc-100 font-medium' : 'text-zinc-500 hover:text-zinc-300'}"
		>
			All ({workspaceFilteredHistory.length})
		</button>
		<button 
			onclick={() => (historyFilter = 'codex')}
			class="py-0.5 rounded transition-colors text-center cursor-pointer {historyFilter === 'codex' ? 'bg-zinc-800 text-emerald-400 font-medium' : 'text-zinc-500 hover:text-zinc-300'}"
		>
			Codex ({countHistory('codex')})
		</button>
		<button 
			onclick={() => (historyFilter = 'deepseek')}
			class="py-0.5 rounded transition-colors text-center cursor-pointer {historyFilter === 'deepseek' ? 'bg-zinc-800 text-violet-400 font-medium' : 'text-zinc-500 hover:text-zinc-300'}"
		>
			R1 ({countHistory('deepseek')})
		</button>
		<button 
			onclick={() => (historyFilter = 'both')}
			class="py-0.5 rounded transition-colors text-center cursor-pointer {historyFilter === 'both' ? 'bg-zinc-800 text-indigo-400 font-medium' : 'text-zinc-500 hover:text-zinc-300'}"
		>
			Dual ({countHistory('both')})
		</button>
		<button 
			onclick={() => (historyFilter = 'consensus')}
			class="py-0.5 rounded transition-colors text-center cursor-pointer {historyFilter === 'consensus' ? 'bg-zinc-800 text-amber-400 font-medium' : 'text-zinc-500 hover:text-zinc-300'}"
		>
			Loop ({countHistory('consensus')})
		</button>
	</div>

	<!-- History Items List -->
	<div class="flex flex-col gap-1.5 max-h-[380px] overflow-y-auto pr-0.5">
		{#each filteredActiveJobs as job}
			<button
				onclick={() => (job.status === 'running' && onWatchJob ? onWatchJob(job) : onOpenQueue && onOpenQueue())}
				class="w-full text-left p-2.5 rounded-lg text-xs transition-colors border flex flex-col gap-1 cursor-pointer {job.status === 'running' ? 'bg-zinc-900 border-emerald-500/50 hover:bg-zinc-850 text-zinc-100' : 'bg-zinc-900 border-amber-500/50 hover:bg-zinc-850 text-zinc-200'}"
			>
				<div class="flex items-center justify-between font-mono text-[10px]">
					<span class="px-1.5 py-0.2 rounded font-medium flex items-center gap-1 {job.status === 'running' ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/60' : 'bg-amber-950/60 text-amber-300 border border-amber-800/60'}">
						{#if job.status === 'running'}
							<RefreshCw class="size-2.5 animate-spin" strokeWidth={1.5} />
							<span>Running · {getActiveJobBadge(job.provider)}</span>
						{:else}
							<Clock class="size-2.5" strokeWidth={1.5} />
							<span>Queued · {getActiveJobBadge(job.provider)}</span>
						{/if}
					</span>
					<span class="text-[10px] font-mono text-zinc-400">LIVE</span>
				</div>
				<div class="text-[11px] line-clamp-2 text-zinc-100 font-sans leading-snug font-medium">
					{job.prompt || '(No prompt)'}
				</div>
				{#if job.stage}
					<div class="text-[10px] text-zinc-400 font-mono truncate">
						{job.stage}
					</div>
				{/if}
				<div class="flex items-center justify-between font-mono text-[10px] text-zinc-500 pt-0.5">
					<span class="truncate max-w-[130px]">{formatWorkspaceLabel(job.workspace)}</span>
					<span class="text-zinc-300 hover:underline">View live →</span>
				</div>
			</button>
		{/each}

		{#each filteredHistory as item}
			{@const badge = getBadgeInfo(item)}
			<button
				onclick={() => onSelectTask(item)}
				class="w-full text-left p-2.5 rounded-lg text-xs transition-colors border flex flex-col gap-1 cursor-pointer {selectedTaskId === item.id ? 'bg-zinc-800/90 border-zinc-600 text-zinc-100 shadow-xs' : 'bg-zinc-950/40 border-zinc-850 text-zinc-400 hover:bg-zinc-850/50 hover:text-zinc-200'}"
			>
				<div class="flex items-center justify-between font-mono text-[10px]">
					<span class="px-1.5 py-0.2 rounded font-medium {badge.class}">
						{badge.label}
					</span>
					<span class="text-zinc-500">{formatTime(item.timestamp)}</span>
				</div>
				<div class="text-[11px] line-clamp-2 text-zinc-200 font-sans leading-snug">
					{item.prompt || '(No prompt)'}
				</div>
				<div class="flex items-center justify-between font-mono text-[10px] text-zinc-500 pt-0.5">
					<span class="truncate max-w-[125px]" title={item.workspace}>{formatWorkspaceLabel(item.workspace)}</span>
					<span class="text-zinc-400" title="Net: {fmtTokens(getNetTokens(item.tokens))} | Total: {fmtTokens(item.tokens?.total_tokens)}">
						{fmtTokens(getNetTokens(item.tokens))} net
					</span>
				</div>
			</button>
		{:else}
			{#if filteredActiveJobs.length === 0}
				<div class="text-[11px] text-zinc-500 py-6 text-center flex flex-col items-center gap-1.5">
					<span>
						{#if searchQuery}
							No results for "{searchQuery}"
						{:else if activeWs && activeWs !== 'all' && activeWs !== 'auto-temp'}
							No history in {activeWs}
						{:else}
							No history items found
						{/if}
					</span>
					{#if activeWs && activeWs !== 'all' && activeWs !== 'auto-temp' && onClearWorkspaceFilter}
						<button 
							onclick={onClearWorkspaceFilter}
							class="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700 cursor-pointer transition-colors"
						>
							Show all history
						</button>
					{/if}
				</div>
			{/if}
		{/each}
	</div>
</div>
