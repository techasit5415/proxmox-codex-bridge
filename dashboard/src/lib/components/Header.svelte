<script lang="ts">
	import { ExternalLink, Settings } from 'lucide-svelte';
	import type { SystemStatus, TokenStats } from '../types';
	import { fmtTokens } from '../types';

	interface Props {
		activeWs: string;
		status: SystemStatus | null;
		tokenStats: TokenStats | null;
		onOpenSettings?: () => void;
	}

	let { activeWs, status, tokenStats, onOpenSettings }: Props = $props();
</script>

<header class="border-b border-zinc-800 bg-zinc-950 px-5 py-3 flex items-center justify-between text-xs">
	<div class="flex items-center gap-3">
		<span class="font-bold text-sm tracking-tight text-zinc-100">codex</span>
		<span class="text-zinc-600">/</span>
		<span class="font-mono text-zinc-300 font-medium">{activeWs}</span>
	</div>

	<!-- System Badges & GPU Cluster -->
	<div class="flex items-center gap-3 font-mono text-[11px] text-zinc-400">
		<div class="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300">
			<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
			<span>{status?.codexAuth || 'ChatGPT Plus'}</span>
		</div>

		<div class="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-violet-300">
			<span class="w-1.5 h-1.5 rounded-full bg-violet-400"></span>
			<span>KMITL GPU (14b)</span>
		</div>

		<div class="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 {status?.redisStatus === 'online' ? 'text-rose-300' : 'text-zinc-500'}">
			<span class="w-1.5 h-1.5 rounded-full {status?.redisStatus === 'online' ? 'bg-rose-400 animate-pulse' : 'bg-zinc-600'}"></span>
			<span>Redis Queue {status?.queueLength ? `(${status.queueLength})` : ''}</span>
		</div>

		{#if tokenStats}
			{@const netTok = tokenStats.netTokens ?? Math.max(0, (tokenStats.totalTokens || 0) - (tokenStats.cachedTokens || 0))}
			<div 
				class="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300"
				title="Net Tokens (ใช้จริงไม่รวม Cache): {fmtTokens(netTok)} | Total (รวม Cache): {fmtTokens(tokenStats.totalTokens)} | Cached: {fmtTokens(tokenStats.cachedTokens)}"
			>
				<span class="text-zinc-500">Net Tok:</span>
				<strong class="text-emerald-400">{fmtTokens(netTok)}</strong>
				{#if tokenStats.cachedTokens > 0}
					<span class="text-[10px] text-zinc-500">({fmtTokens(tokenStats.totalTokens)} tot)</span>
				{/if}
			</div>
		{/if}

		<div class="hidden lg:flex items-center gap-1 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800">
			<span class="text-zinc-500">RAM:</span>
			<span>{status?.memoryUsage || '...'}</span>
		</div>

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
