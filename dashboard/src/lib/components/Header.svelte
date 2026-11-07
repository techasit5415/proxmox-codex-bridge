<script lang="ts">
	import { ExternalLink, Settings, HardDrive, Layers, Cpu, Radio } from 'lucide-svelte';
	import type { SystemStatus, TokenStats } from '../types';
	import { fmtTokens } from '../types';

	interface Props {
		activeWs: string;
		status: SystemStatus | null;
		tokenStats: TokenStats | null;
		onOpenSettings?: () => void;
		onOpenQueue?: () => void;
	}

	let { activeWs, status, tokenStats, onOpenSettings, onOpenQueue }: Props = $props();

	let isRedisOnline = $derived(status?.redisStatus === 'online');
	let queueWait = $derived(status?.queueLength ?? 0);
	let queueRun = $derived(status?.processingCount ?? 0);
	let isBusy = $derived(isRedisOnline && (queueWait > 0 || queueRun > 0));

	let diskPctNum = $derived.by(() => {
		const raw = status?.diskPercent || '';
		const n = parseInt(raw.replace('%', ''), 10);
		return Number.isFinite(n) ? n : 0;
	});

	let diskColorClass = $derived(
		diskPctNum >= 90 ? 'text-rose-400' : diskPctNum >= 75 ? 'text-amber-300' : 'text-zinc-200'
	);
</script>

<header class="border-b border-zinc-800/80 bg-zinc-950 px-4 sm:px-6 h-14 flex items-center justify-between gap-3 text-xs">
	<div class="flex items-center gap-2.5">
		<span class="font-semibold text-sm tracking-tight text-zinc-100">codex-bridge</span>
		<span class="text-zinc-700">/</span>
		<span class="font-mono text-zinc-300 text-[11px] px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800/80">
			{activeWs}
		</span>
	</div>

	<!-- System Badges: AI Engines, Queue, Disk Free, RAM, Tokens -->
	<div class="flex items-center gap-2 font-mono text-[11px] text-zinc-400">
		<!-- OpenAI Codex Auth -->
		<div class="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900/90 border border-zinc-800 text-zinc-300" title="OpenAI Codex CLI ({status?.codexVersion || 'codex'})">
			<span class="size-1.5 rounded-full bg-emerald-500"></span>
			<span>{status?.codexAuth || 'ChatGPT Plus'}</span>
		</div>

		<!-- KMITL GPU Cluster -->
		<div class="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900/90 border border-zinc-800 text-zinc-300" title="DeepSeek R1 14b (CS KMITL GPU · 16K Context)">
			<span class="size-1.5 rounded-full bg-zinc-400"></span>
			<span>KMITL GPU (14b)</span>
		</div>

		<!-- Live Redis Queue Status -->
		<button 
			type="button"
			onclick={onOpenQueue}
			class="flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition-colors cursor-pointer {isRedisOnline ? (isBusy ? 'bg-zinc-900 hover:bg-zinc-800 border-amber-500/50 text-amber-200' : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-300') : 'bg-rose-950/20 border-rose-900/40 text-rose-300'}"
			title={isRedisOnline ? `Job queue: ${queueWait} waiting, ${queueRun} processing` : 'Redis Queue Offline'}
		>
			<Layers class="size-3 text-zinc-400" strokeWidth={1.5} />
			<span>Queue:</span>
			{#if isRedisOnline}
				<strong class="tabular-nums {queueWait > 0 ? 'text-amber-300' : 'text-zinc-200'}">{queueWait} wait</strong>
				<span class="text-zinc-600">·</span>
				<strong class="tabular-nums {queueRun > 0 ? 'text-emerald-400' : 'text-zinc-400'}">{queueRun} run</strong>
			{:else}
				<strong class="text-rose-400">Offline</strong>
			{/if}
		</button>

		<!-- Remaining Disk Space -->
		<div 
			class="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900/90 border border-zinc-800 text-zinc-300"
			title="Free disk space: {status?.diskFree || 'N/A'}"
		>
			<HardDrive class="size-3 {diskColorClass} shrink-0" strokeWidth={1.5} />
			<span class="text-zinc-400">Disk:</span>
			<strong class="tabular-nums {diskColorClass}">{status?.diskFree || '...'}</strong>
		</div>

		<!-- RAM Usage -->
		<div 
			class="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900/90 border border-zinc-800 text-zinc-300"
			title="หน่วยความจำ RAM ของ Proxmox CT"
		>
			<Cpu class="size-3 text-zinc-400 shrink-0" strokeWidth={1.5} />
			<span class="text-zinc-400">RAM:</span>
			<span class="tabular-nums">{status?.memoryUsage || '...'}</span>
		</div>

		<!-- Net Tokens -->
		{#if tokenStats}
			{@const netTok = tokenStats.netTokens ?? Math.max(0, (tokenStats.totalTokens || 0) - (tokenStats.cachedTokens || 0))}
			<div 
				class="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900/90 border border-zinc-800 text-zinc-300"
				title="Net Tokens: {fmtTokens(netTok)}"
			>
				<span class="text-zinc-400">Net Tok:</span>
				<strong class="tabular-nums text-zinc-200">{fmtTokens(netTok)}</strong>
			</div>
		{/if}

		{#if onOpenSettings}
			<button 
				onclick={onOpenSettings}
				class="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 transition-colors cursor-pointer font-sans"
				title="ตั้งค่า AI Models"
			>
				<Settings class="size-3 text-zinc-400" strokeWidth={1.5} />
				<span class="font-medium">Models</span>
			</button>
		{/if}

		<a 
			href="https://github.com/techasit5415/proxmox-codex-bridge" 
			target="_blank" 
			rel="noreferrer"
			class="text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1 pl-1"
		>
			<span>Repo</span>
			<ExternalLink class="size-3 text-zinc-500" strokeWidth={1.5} />
		</a>
	</div>
</header>
