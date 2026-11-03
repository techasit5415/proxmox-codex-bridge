<script lang="ts">
	import { ChevronRight } from 'lucide-svelte';
	import type { TaskResult } from '../types';
	import { fmtTokenBadge, extractThoughtAndBody } from '../types';
	import ChainOfThought from './ChainOfThought.svelte';
	import DiffViewer from './DiffViewer.svelte';

	interface Props {
		result: TaskResult;
		onViewDiffTab: () => void;
	}

	let { result, onViewDiffTab }: Props = $props();

	let parsed = $derived(extractThoughtAndBody(result.logs || ''));
	let isDS = $derived(result.provider?.includes('DeepSeek'));
</script>

<div class="flex flex-col gap-3 font-sans text-xs">
	<!-- Model Indicator Header -->
	<div class="p-2.5 rounded-lg border {isDS ? 'bg-violet-950/40 border-violet-900/50 text-violet-200' : 'bg-zinc-900 border-zinc-800 text-zinc-200'} flex items-center justify-between font-mono">
		<div class="flex items-center gap-2">
			<span class="w-2 h-2 rounded-full {isDS ? 'bg-violet-400' : 'bg-emerald-400'}"></span>
			<span class="font-bold text-xs">{result.provider || 'Codex'}</span>
			{#if result.branch}
				<span class="text-[10px] px-1.5 py-0.2 rounded {isDS ? 'bg-violet-900/60 text-violet-300' : 'bg-zinc-800 text-zinc-400'}">{result.branch}</span>
			{/if}
		</div>
		{#if result.tokens?.total_tokens}
			<span class="text-[11px] {isDS ? 'text-violet-300' : 'text-emerald-400'}">{fmtTokenBadge(result.tokens)}</span>
		{/if}
	</div>

	<!-- Model Thinking Card (Collapsible) -->
	{#if parsed.thoughts}
		<ChainOfThought thoughts={parsed.thoughts} defaultExpanded={false} />
	{/if}

	<!-- Actual Model Response / Output -->
	<div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-2.5">
		<div class="flex items-center justify-between text-xs pb-2 border-b border-zinc-800/80">
			<span class="font-semibold text-zinc-100 flex items-center gap-1.5 font-mono">
				<span class="text-emerald-400">●</span>
				<span>Model Response / คำตอบการวิเคราะห์</span>
			</span>
			{#if result.diff && result.diff !== '(No tracked files modified)'}
				<button 
					onclick={onViewDiffTab}
					class="text-[11px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center gap-1 font-mono transition cursor-pointer"
				>
					<span>View Git Diff</span>
					<ChevronRight class="w-3 h-3 text-zinc-400" />
				</button>
			{/if}
		</div>

		{#if parsed.body}
			<div class="text-zinc-200 whitespace-pre-wrap leading-relaxed font-mono text-xs select-text">
				{parsed.body}
			</div>
		{:else}
			<div class="text-zinc-500 italic py-2 font-mono">No response body recorded.</div>
		{/if}
	</div>

	<!-- Diff preview if present -->
	{#if result.diff}
		<DiffViewer diff={result.diff} branch={result.branch} providerColor={isDS ? 'violet' : 'emerald'} collapsible={true} />
	{/if}
</div>
