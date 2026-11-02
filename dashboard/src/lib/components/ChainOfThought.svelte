<script lang="ts">
	import { Brain, ChevronDown, ChevronRight } from 'lucide-svelte';

	interface Props {
		thoughts: string;
		defaultExpanded?: boolean;
	}

	let { thoughts, defaultExpanded = false }: Props = $props();
	let expanded = $state<boolean>(false);
	$effect.pre(() => {
		expanded = defaultExpanded;
	});
</script>

{#if thoughts}
	<div class="rounded-lg border border-violet-900/50 bg-violet-950/25 p-3 flex flex-col gap-2 font-mono">
		<button 
			onclick={() => (expanded = !expanded)}
			class="flex items-center justify-between text-violet-300 text-xs font-semibold cursor-pointer select-none"
		>
			<div class="flex items-center gap-2">
				<Brain class="w-4 h-4 text-violet-400" />
				<span>Chain of Thought (กระบวนการคิด)</span>
				<span class="text-[10px] px-1.5 py-0.2 rounded bg-violet-900/60 text-violet-300 border border-violet-800/60 font-mono">
					{thoughts.length.toLocaleString()} chars
				</span>
			</div>
			<div class="flex items-center gap-1 text-[11px] text-violet-400 font-medium">
				<span>{expanded ? 'Collapse' : 'Expand Thoughts'}</span>
				{#if expanded}
					<ChevronDown class="w-3.5 h-3.5" />
				{:else}
					<ChevronRight class="w-3.5 h-3.5" />
				{/if}
			</div>
		</button>

		{#if expanded}
			<div class="pt-2.5 border-t border-violet-900/30 text-violet-200/90 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto pr-1 selection:bg-violet-500/25 text-[11px]">
				{thoughts}
			</div>
		{/if}
	</div>
{/if}
