<script lang="ts">
	import { ExternalLink, Settings, HardDrive, Layers, Cpu } from 'lucide-svelte';
	import type { SystemStatus, TokenStats } from '../types';
	import { fmtTokens } from '../types';

	interface Props {
		activeWs: string;
		status: SystemStatus | null;
		tokenStats: TokenStats | null;
		onOpenSettings?: () => void;
	}

	let { activeWs, status, tokenStats, onOpenSettings }: Props = $props();

	let queueWait = $derived(status?.queueLength ?? 0);
	let queueRun = $derived(status?.processingCount ?? 0);
	let isBusy = $derived(queueWait > 0 || queueRun > 0);
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

		<!-- Live Redis Queue Status (คิวรอ + กำลังรัน) -->
		<div 
			class="flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition {status?.redisStatus === 'online' ? (isBusy ? 'bg-amber-950/50 border-amber-600/60 text-amber-200' : 'bg-zinc-900 border-zinc-800 text-cyan-300') : 'bg-zinc-900 border-zinc-800 text-zinc-500'}"
			title="สถานะ Redis Queue ({status?.redisStatus || 'offline'}): คิวรอ {queueWait} งาน | กำลังประมวลผล {queueRun} งาน"
		>
			<Layers class="w-3 h-3 {isBusy ? 'text-amber-400 animate-bounce' : status?.redisStatus === 'online' ? 'text-cyan-400' : 'text-zinc-600'}" />
			<span>คิว:</span>
			<strong class={queueWait > 0 ? 'text-amber-300' : 'text-zinc-200'}>{queueWait} รอ</strong>
			<span class="text-zinc-600">·</span>
			<strong class={queueRun > 0 ? 'text-emerald-400 animate-pulse' : 'text-zinc-400'}>{queueRun} รัน</strong>
		</div>

		<!-- Remaining Disk Space (พื้นที่ที่เหลือ) -->
		<div 
			class="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-200"
			title="พื้นที่ดิสก์ Proxmox CT (/): เหลือว่าง {status?.diskFree || '...'} | ใช้ไป {status?.diskUsage || '...'}"
		>
			<HardDrive class="w-3 h-3 text-emerald-400 shrink-0" />
			<span class="text-zinc-400">พท.เหลือ:</span>
			<strong class="text-emerald-400">{status?.diskFree || '...'}</strong>
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
				title="Net Tokens (ใช้จริงไม่รวม Cache): {fmtTokens(netTok)} | Total (รวม Cache): {fmtTokens(tokenStats.totalTokens)} | Cached: {fmtTokens(tokenStats.cachedTokens)}"
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
