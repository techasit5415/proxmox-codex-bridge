<script lang="ts">
	import { ExternalLink } from 'lucide-svelte';
	import type { SystemStatus, TokenStats } from '../types';
	import { fmtTokens } from '../types';

	interface Props {
		activeWs: string;
		status: SystemStatus | null;
		tokenStats: TokenStats | null;
	}

	let { activeWs, status, tokenStats }: Props = $props();
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

		{#if tokenStats}
			<div class="hidden md:flex items-center gap-1 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300">
				<span class="text-zinc-500">Tokens:</span>
				<strong class="text-zinc-100">{fmtTokens(tokenStats.totalTokens)}</strong>
			</div>
		{/if}

		<div class="hidden lg:flex items-center gap-1 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800">
			<span class="text-zinc-500">RAM:</span>
			<span>{status?.memoryUsage || '...'}</span>
		</div>

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
