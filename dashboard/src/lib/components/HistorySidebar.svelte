<script lang="ts">
	import { History, RotateCcw } from 'lucide-svelte';
	import type { TaskRecord } from '../types';
	import { fmtTokens } from '../types';

	interface Props {
		history: TaskRecord[];
		selectedTaskId: string | null;
		isLoading: boolean;
		activeWs?: string;
		onSelectTask: (item: TaskRecord) => void;
		onRefresh: () => void;
		onClearWorkspaceFilter?: () => void;
	}

	let { 
		history, 
		selectedTaskId, 
		isLoading, 
		activeWs = 'all',
		onSelectTask, 
		onRefresh,
		onClearWorkspaceFilter
	}: Props = $props();

	let historyFilter = $state<'all' | 'codex' | 'deepseek' | 'both' | 'consensus'>('all');

	// Step 1: Filter by Workspace if one is selected
	let workspaceFilteredHistory = $derived.by(() => {
		if (!activeWs || activeWs === 'all') return history;
		if (activeWs === 'auto-temp') {
			return history.filter(h => h.workspace?.startsWith('temp-'));
		}
		return history.filter(h => h.workspace === activeWs);
	});

	// Step 2: Filter by Model / Mode pills
	let filteredHistory = $derived.by(() => {
		const base = workspaceFilteredHistory;
		if (historyFilter === 'all') return base;
		if (historyFilter === 'consensus') return base.filter(h => h.mode === 'consensus' || h.provider?.includes('Consensus'));
		if (historyFilter === 'codex') return base.filter(h => h.mode !== 'both' && h.mode !== 'consensus' && !h.provider?.includes('Dual') && !h.provider?.includes('Consensus') && (h.provider?.includes('Codex') || !h.provider?.includes('DeepSeek')));
		if (historyFilter === 'deepseek') return base.filter(h => h.mode !== 'both' && h.mode !== 'consensus' && !h.provider?.includes('Dual') && !h.provider?.includes('Consensus') && h.provider?.includes('DeepSeek'));
		if (historyFilter === 'both') return base.filter(h => h.mode === 'both' || h.provider?.includes('Dual'));
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
			return { label: 'Consensus', class: 'bg-amber-950/80 text-amber-300 border border-amber-800/80' };
		}
		if (item.mode === 'both' || item.provider?.includes('Dual')) {
			return { label: 'Dual', class: 'bg-indigo-950/80 text-indigo-300 border border-indigo-800/80' };
		}
		if (item.provider?.includes('DeepSeek')) {
			return { label: 'DeepSeek', class: 'bg-violet-950/70 text-violet-300 border border-violet-800/60' };
		}
		return { label: 'Codex', class: 'bg-zinc-800 text-zinc-300 border border-zinc-700' };
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

<div class="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 flex flex-col gap-2">
	<div class="flex items-center justify-between text-xs">
		<div class="flex items-center gap-1.5 text-zinc-400 font-medium overflow-hidden">
			<History class="w-3.5 h-3.5 text-zinc-500 shrink-0" />
			<span class="shrink-0">History</span>
			{#if activeWs && activeWs !== 'all'}
				<span class="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 font-mono truncate max-w-[75px]" title="กรองตาม: {activeWs}">
					{activeWs === 'auto-temp' ? 'temp-*' : activeWs}
				</span>
				{#if onClearWorkspaceFilter}
					<button 
						onclick={onClearWorkspaceFilter}
						title="ล้างตัวกรอง Workspace (ดูทั้งหมด)"
						class="text-[9px] text-zinc-500 hover:text-zinc-200 transition cursor-pointer shrink-0"
					>✕</button>
				{/if}
			{/if}
			<span class="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 font-mono shrink-0">{filteredHistory.length}</span>
		</div>
		<button 
			onclick={onRefresh}
			title="Refresh History"
			class="text-zinc-500 hover:text-zinc-300 transition cursor-pointer"
		>
			<RotateCcw class="w-3 h-3 {isLoading ? 'animate-spin' : ''}" />
		</button>
	</div>

	<!-- Quick Model Filter Pills -->
	<div class="grid grid-cols-5 gap-0.5 p-0.5 bg-zinc-950/80 rounded-md border border-zinc-800/80 text-[10px] font-mono">
		<button 
			onclick={() => (historyFilter = 'all')}
			class="py-0.5 rounded transition text-center cursor-pointer {historyFilter === 'all' ? 'bg-zinc-800 text-zinc-100 font-semibold' : 'text-zinc-500 hover:text-zinc-300'}"
		>
			All ({history.length})
		</button>
		<button 
			onclick={() => (historyFilter = 'codex')}
			class="py-0.5 rounded transition text-center cursor-pointer {historyFilter === 'codex' ? 'bg-zinc-800 text-emerald-400 font-semibold border border-zinc-700' : 'text-zinc-500 hover:text-zinc-300'}"
		>
			Codex ({countHistory('codex')})
		</button>
		<button 
			onclick={() => (historyFilter = 'deepseek')}
			class="py-0.5 rounded transition text-center cursor-pointer {historyFilter === 'deepseek' ? 'bg-violet-950 text-violet-300 border border-violet-800 font-semibold' : 'text-zinc-500 hover:text-zinc-300'}"
		>
			R1 ({countHistory('deepseek')})
		</button>
		<button 
			onclick={() => (historyFilter = 'both')}
			class="py-0.5 rounded transition text-center cursor-pointer {historyFilter === 'both' ? 'bg-indigo-950 text-indigo-300 border border-indigo-800 font-semibold' : 'text-zinc-500 hover:text-zinc-300'}"
		>
			Dual ({countHistory('both')})
		</button>
		<button 
			onclick={() => (historyFilter = 'consensus')}
			class="py-0.5 rounded transition text-center cursor-pointer {historyFilter === 'consensus' ? 'bg-amber-950 text-amber-300 border border-amber-800 font-semibold' : 'text-zinc-500 hover:text-zinc-300'}"
		>
			Loop ({countHistory('consensus')})
		</button>
	</div>

	<div class="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-0.5">
		{#each filteredHistory as item}
			{@const badge = getBadgeInfo(item)}
			<button
				onclick={() => onSelectTask(item)}
				class="w-full text-left p-2 rounded text-xs transition border flex flex-col gap-1 cursor-pointer {selectedTaskId === item.id ? 'bg-zinc-800 border-zinc-700 text-zinc-100 shadow-xs' : 'bg-zinc-950/40 border-zinc-900 text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-300'}"
			>
				<div class="flex items-center justify-between font-mono text-[10px]">
					<span class="px-1.5 py-0.2 rounded font-medium {badge.class}">
						{badge.label}
					</span>
					<span class="text-zinc-500">{formatTime(item.timestamp)}</span>
				</div>
				<div class="text-[11px] truncate text-zinc-200 font-sans">
					{item.prompt || '(No prompt)'}
				</div>
				<div class="flex items-center justify-between font-mono text-[10px] text-zinc-500">
					<span class="truncate max-w-[100px]">{item.workspace}</span>
					<span>{fmtTokens(item.tokens?.total_tokens)} tok</span>
				</div>
			</button>
		{:else}
			<div class="text-[11px] text-zinc-500 italic py-3 text-center flex flex-col items-center gap-1">
				<span>
					{#if activeWs && activeWs !== 'all'}
						ไม่มีประวัติใน {activeWs === 'auto-temp' ? 'Auto Temp' : activeWs}
					{:else}
						ไม่มีประวัติที่ตรงกับตัวกรอง
					{/if}
				</span>
				{#if activeWs && activeWs !== 'all' && onClearWorkspaceFilter}
					<button 
						onclick={onClearWorkspaceFilter}
						class="text-[10px] text-cyan-400 hover:underline cursor-pointer"
					>
						ดูประวัติของทุก Workspace
					</button>
				{/if}
			</div>
		{/each}
	</div>
</div>
