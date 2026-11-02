<script lang="ts">
	import { Copy, Check, ChevronDown } from 'lucide-svelte';

	interface Props {
		diff: string;
		branch?: string;
		providerColor?: 'emerald' | 'violet' | 'zinc';
		collapsible?: boolean;
		defaultExpanded?: boolean;
	}

	let {
		diff,
		branch = '',
		providerColor = 'emerald',
		collapsible = false,
		defaultExpanded = false
	}: Props = $props();

	let expanded = $state<boolean>(defaultExpanded);
	let copied = $state<boolean>(false);

	function copyDiff() {
		if (!diff) return;
		navigator.clipboard.writeText(diff);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	const colorClasses = {
		emerald: {
			border: 'border-zinc-800',
			text: 'text-emerald-400',
			diffText: 'text-zinc-300'
		},
		violet: {
			border: 'border-violet-900/40',
			text: 'text-violet-300',
			diffText: 'text-violet-200'
		},
		zinc: {
			border: 'border-zinc-800',
			text: 'text-zinc-300',
			diffText: 'text-zinc-300'
		}
	};
</script>

{#if diff && diff !== '(No tracked files modified)' && diff !== '(No files modified)'}
	<div class="rounded-lg border {colorClasses[providerColor].border} bg-zinc-950 p-2.5 font-mono text-xs">
		{#if collapsible}
			<button 
				onclick={() => (expanded = !expanded)}
				class="w-full flex items-center justify-between text-xs {colorClasses[providerColor].text} hover:opacity-80 cursor-pointer"
			>
				<span class="font-medium">Git Diff {branch ? `(${branch})` : ''}</span>
				<div class="flex items-center gap-2">
					<button 
						onclick={(e) => { e.stopPropagation(); copyDiff(); }}
						class="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center gap-1 cursor-pointer"
					>
						{#if copied}
							<Check class="w-2.5 h-2.5 text-emerald-400" />
							<span>Copied</span>
						{:else}
							<Copy class="w-2.5 h-2.5" />
							<span>Copy</span>
						{/if}
					</button>
					<div class="flex items-center gap-1 text-[11px]">
						<span>{expanded ? 'Hide' : 'View'}</span>
						<ChevronDown class="w-3.5 h-3.5 {expanded ? 'rotate-180' : ''} transition-transform" />
					</div>
				</div>
			</button>
			{#if expanded}
				<pre class="mt-2 text-[11px] {colorClasses[providerColor].diffText} whitespace-pre-wrap overflow-x-auto max-h-60 p-2 bg-zinc-900/70 rounded border border-zinc-800">{diff}</pre>
			{/if}
		{:else}
			<div class="flex items-center justify-between mb-2">
				<span class="font-medium {colorClasses[providerColor].text}">Git Diff {branch ? `(${branch})` : ''}:</span>
				<button 
					onclick={copyDiff}
					class="text-[11px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center gap-1 cursor-pointer"
				>
					{#if copied}
						<Check class="w-3 h-3 text-emerald-400" />
						<span>Copied</span>
					{:else}
						<Copy class="w-3 h-3" />
						<span>Copy Diff</span>
					{/if}
				</button>
			</div>
			<pre class="text-[11px] {colorClasses[providerColor].diffText} whitespace-pre-wrap overflow-x-auto p-2.5 bg-zinc-900/60 rounded border border-zinc-800">{diff}</pre>
		{/if}
	</div>
{/if}
