<script lang="ts">
	import { History, RotateCcw, Search, Plus } from 'lucide-svelte';
	import type { TaskRecord } from '../types';
	import { fmtTokens, getNetTokens } from '../types';

	interface Props {
		history: TaskRecord[];
		selectedTaskId: string | null;
		isLoading: boolean;
		activeWs?: string;
		onSelectTask: (item: TaskRecord) => void;
		onRefresh: () => void;
		onClearWorkspaceFilter?: () => void;
		onNewTask?: () => void;
	}

	let { 
		history, 
		selectedTaskId, 
		isLoading, 
		activeWs = 'all',
		onSelectTask, 
		onRefresh,
		onClearWorkspaceFilter,
		onNewTask
	}: Props = $props();

	let historyFilter = $state<'all' | 'codex' | 'deepseek' | 'both' | 'consensus'>('all');
	let searchQuery = $state<string>('');

	// Step 1: Filter by Workspace if a specific project/temp folder is selected
	let workspaceFilteredHistory = $derived.by(() => {
		if (!activeWs || activeWs === 'all' || activeWs === 'auto-temp') return history;
		return history.filter(h => h.workspace === activeWs);
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
			return { label: '🏆 Consensus', class: 'bg-amber-950/80 text-amber-300 border border-amber-800/80' };
		}
		if (item.mode === 'both' || item.provider?.includes('Dual')) {
			return { label: '⚡ Compare', class: 'bg-indigo-950/80 text-indigo-300 border border-indigo-800/80' };
		}
		if (item.provider?.includes('DeepSeek')) {
			return { label: '🧠 DeepSeek R1', class: 'bg-violet-950/70 text-violet-300 border border-violet-800/60' };
		}
		return { label: '🤖 Codex', class: 'bg-zinc-800 text-emerald-300 border border-zinc-700' };
	}

	function formatWorkspaceLabel(ws?: string): string {
		if (!ws) return 'temp';
		if (ws.startsWith('temp-')) {
			return '✨ ' + ws.replace(/^temp-/, '').replace(/-[a-z0-9]{4}$/i, '');
		}
		return '📁 ' + ws;
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
	<div class="flex items-center justify-between text-xs">
		<div class="flex items-center gap-1.5 text-zinc-200 font-semibold overflow-hidden">
			<History class="w-3.5 h-3.5 text-cyan-400 shrink-0" />
			<span class="shrink-0">ประวัติงาน (History)</span>
			{#if activeWs && activeWs !== 'all' && activeWs !== 'auto-temp'}
				<span class="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono truncate max-w-[85px]" title="กรองตาม: {activeWs}">
					{activeWs}
				</span>
				{#if onClearWorkspaceFilter}
					<button 
						onclick={onClearWorkspaceFilter}
						title="ล้างตัวกรอง Workspace (ดูทั้งหมด)"
						class="text-[10px] text-zinc-400 hover:text-zinc-100 transition cursor-pointer shrink-0"
					>✕</button>
				{/if}
			{/if}
			<span class="text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-300 font-mono shrink-0">{filteredHistory.length}</span>
		</div>

		<div class="flex items-center gap-1.5">
			{#if selectedTaskId && onNewTask}
				<button
					onclick={onNewTask}
					class="text-[10px] px-2 py-0.5 rounded bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 transition flex items-center gap-0.5 cursor-pointer font-medium"
					title="กลับไปหน้าพิมพ์คำสั่งใหม่"
				>
					<Plus class="w-2.5 h-2.5" />
					<span>งานใหม่</span>
				</button>
			{/if}
			<button 
				onclick={onRefresh}
				title="รีเฟรชประวัติ"
				class="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
			>
				<RotateCcw class="w-3 h-3 {isLoading ? 'animate-spin text-cyan-400' : ''}" />
			</button>
		</div>
	</div>

	<!-- Search History Input -->
	<div class="relative">
		<Search class="w-3 h-3 absolute left-2.5 top-2 text-zinc-500" />
		<input
			type="text"
			bind:value={searchQuery}
			placeholder="ค้นหาประวัติแชท หรือคำสั่ง..."
			class="w-full pl-7 pr-6 py-1 bg-zinc-950/90 border border-zinc-800 rounded-md text-[11px] text-zinc-200 focus:outline-none focus:border-zinc-700 placeholder:text-zinc-600"
		/>
		{#if searchQuery}
			<button
				onclick={() => (searchQuery = '')}
				class="absolute right-2 top-1 text-zinc-500 hover:text-zinc-300 text-xs cursor-pointer"
			>&times;</button>
		{/if}
	</div>

	<!-- Quick Model Filter Pills -->
	<div class="grid grid-cols-5 gap-0.5 p-0.5 bg-zinc-950/80 rounded-md border border-zinc-800/80 text-[10px] font-mono">
		<button 
			onclick={() => (historyFilter = 'all')}
			class="py-0.5 rounded transition text-center cursor-pointer {historyFilter === 'all' ? 'bg-zinc-800 text-zinc-100 font-semibold' : 'text-zinc-500 hover:text-zinc-300'}"
		>
			All ({workspaceFilteredHistory.length})
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

	<div class="flex flex-col gap-1.5 max-h-[380px] overflow-y-auto pr-0.5">
		{#each filteredHistory as item}
			{@const badge = getBadgeInfo(item)}
			<button
				onclick={() => onSelectTask(item)}
				class="w-full text-left p-2.5 rounded-lg text-xs transition border flex flex-col gap-1 cursor-pointer {selectedTaskId === item.id ? 'bg-indigo-950/40 border-indigo-500/60 text-zinc-100 shadow-xs' : 'bg-zinc-950/50 border-zinc-800/70 text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'}"
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
					<span class="text-emerald-400/90" title="Net: {fmtTokens(getNetTokens(item.tokens))} | Total: {fmtTokens(item.tokens?.total_tokens)} | Cached: {fmtTokens(item.tokens?.cached_input_tokens)}">
						{fmtTokens(getNetTokens(item.tokens))} net
					</span>
				</div>
			</button>
		{:else}
			<div class="text-[11px] text-zinc-500 italic py-4 text-center flex flex-col items-center gap-1.5">
				<span>
					{#if searchQuery}
						ไม่พบประวัติที่ตรงกับ "{searchQuery}"
					{:else if activeWs && activeWs !== 'all' && activeWs !== 'auto-temp'}
						ยังไม่มีประวัติรันงานในโปรเจกต์ {activeWs}
					{:else}
						ไม่มีประวัติที่ตรงกับตัวกรอง
					{/if}
				</span>
				{#if activeWs && activeWs !== 'all' && activeWs !== 'auto-temp' && onClearWorkspaceFilter}
					<button 
						onclick={onClearWorkspaceFilter}
						class="text-[11px] px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 hover:bg-cyan-500/20 cursor-pointer not-italic"
					>
						แสดงประวัติของทุกโปรเจกต์
					</button>
				{/if}
			</div>
		{/each}
	</div>
</div>
