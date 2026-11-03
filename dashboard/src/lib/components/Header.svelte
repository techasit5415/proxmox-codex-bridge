<script lang="ts">
	import { ExternalLink, Settings, HardDrive, Layers, Cpu } from 'lucide-svelte';
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
		diskPctNum >= 90 ? 'text-rose-400' : diskPctNum >= 75 ? 'text-amber-300' : 'text-emerald-400'
	);
</script>

<header class="border-b border-zinc-800 bg-zinc-950 px-4 sm:px-5 py-2.5 flex items-center justify-between gap-3 text-xs flex-wrap">
	<div class="flex items-center gap-2.5">
		<span class="font-bold text-sm tracking-tight text-zinc-100">codex-bridge</span>
		<span class="text-zinc-600">/</span>
		<span class="font-mono text-zinc-200 font-medium px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800">{activeWs}</span>
	</div>

	<!-- System Badges: AI Engines, Queue, Disk Free, RAM, Tokens -->
	<div class="flex items-center gap-2 font-mono text-[11px] text-zinc-300 flex-wrap">
		<!-- OpenAI Codex Auth -->
		<div class="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-200" title="สถานะ OpenAI Codex CLI ({status?.codexVersion || 'codex'})">
			<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
			<span>{status?.codexAuth || 'ChatGPT Plus'}</span>
		</div>

		<!-- KMITL GPU Cluster -->
		<div class="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-violet-300" title="DeepSeek R1 14b (CS KMITL GPU · 16K Context + Web Search)">
			<span class="w-1.5 h-1.5 rounded-full bg-violet-400"></span>
			<span>KMITL GPU (14b)</span>
		</div>

		<!-- Live Redis Queue Status (Clickable to inspect active/waiting jobs!) -->
		<button 
			type="button"
			onclick={onOpenQueue}
			class="flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition cursor-pointer {isRedisOnline ? (isBusy ? 'bg-amber-950/60 hover:bg-amber-900/70 border-amber-500/70 text-amber-200 shadow-[0_0_10px_rgba(245,158,11,0.2)]' : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 hover:border-cyan-500/40 text-cyan-300') : 'bg-rose-950/30 border-rose-800/50 text-rose-300'}"
			title={isRedisOnline ? `คลิกเพื่อเปิดดูรายละเอียดคิวงานสด (คิวรอ ${queueWait} งาน | กำลังรัน ${queueRun} งาน)` : 'Redis Queue Offline — คลิกเพื่อดูสถานะ'}
		>
			<Layers class="w-3 h-3 {isBusy ? 'text-amber-400 animate-bounce' : isRedisOnline ? 'text-cyan-400' : 'text-rose-400'}" />
			<span>คิว:</span>
			{#if isRedisOnline}
				<strong class={queueWait > 0 ? 'text-amber-300' : 'text-zinc-200'}>{queueWait} รอ</strong>
				<span class="text-zinc-600">·</span>
				<strong class={queueRun > 0 ? 'text-emerald-400 animate-pulse' : 'text-zinc-400'}>{queueRun} รัน</strong>
			{:else}
				<strong class="text-rose-400">Offline</strong>
			{/if}
		</button>

		<!-- Remaining Disk Space (พื้นที่ดิสก์ที่เหลือใน Workspaces) -->
		<div 
			class="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-200"
			title="พื้นที่ดิสก์ Workspaces (/opt/agent-bridge/workspaces): เหลือว่าง {status?.diskFree || 'N/A'} | ใช้ไป {status?.diskUsage || 'N/A'}"
		>
			<HardDrive class="w-3 h-3 {diskColorClass} shrink-0" />
			<span class="text-zinc-400">พท.เหลือ:</span>
			<strong class={diskColorClass}>{status?.diskFree || '...'}</strong>
			{#if status?.diskPercent}
				<span class="text-[10px] text-zinc-500">(ใช้ {status.diskPercent})</span>
			{/if}
		</div>

		<!-- RAM Usage -->
		<div 
			class="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300"
			title="หน่วยความจำ RAM ของ Proxmox CT ที่ใช้ไป / ทั้งหมด"
		>
			<Cpu class="w-3 h-3 text-indigo-400 shrink-0" />
			<span class="text-zinc-400">RAM:</span>
			<span>{status?.memoryUsage || '...'}</span>
		</div>

		<!-- Net Tokens -->
		{#if tokenStats}
			{@const netTok = tokenStats.netTokens ?? Math.max(0, (tokenStats.totalTokens || 0) - (tokenStats.cachedTokens || 0))}
			<div 
				class="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300"
				title="Net Tokens (หัก Cached Input แล้ว): {fmtTokens(netTok)} | Total (รวม Cache): {fmtTokens(tokenStats.totalTokens)} | Cached: {fmtTokens(tokenStats.cachedTokens)}"
			>
				<span class="text-zinc-400">Net Tok:</span>
				<strong class="text-emerald-400">{fmtTokens(netTok)}</strong>
				{#if tokenStats.cachedTokens > 0}
					<span class="text-[10px] text-zinc-500">({fmtTokens(tokenStats.totalTokens)} tot)</span>
				{/if}
			</div>
		{/if}

		{#if onOpenSettings}
			<button 
				onclick={onOpenSettings}
				class="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 transition cursor-pointer font-sans"
				title="ตั้งค่า AI Models (Claude, OpenAI, Gemini)"
			>
				<Settings class="w-3.5 h-3.5 text-amber-400" />
				<span class="font-medium">Models</span>
			</button>
		{/if}

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
