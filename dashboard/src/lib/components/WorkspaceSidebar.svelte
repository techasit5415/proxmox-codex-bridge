<script lang="ts">
	import { Plus, GitBranch } from 'lucide-svelte';
	import type { WorkspaceDetails } from '../types';

	interface Props {
		workspaces: string[];
		activeWs: string;
		wsDetails: WorkspaceDetails | null;
		onSelectWorkspace: (ws: string) => void;
		onOpenClone: () => void;
	}

	let { workspaces, activeWs, wsDetails, onSelectWorkspace, onOpenClone }: Props = $props();
</script>

<div class="flex flex-col gap-4">
	<!-- Workspaces List -->
	<div class="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3.5 flex flex-col gap-2.5">
		<div class="flex items-center justify-between text-xs">
			<span class="font-medium text-zinc-400">Workspaces</span>
			<button 
				onclick={onOpenClone}
				class="text-[11px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition flex items-center gap-1 cursor-pointer"
			>
				<Plus class="w-2.5 h-2.5" />
				<span>Clone</span>
			</button>
		</div>

		<div class="flex flex-col gap-1">
			{#each workspaces as ws}
				<button 
					onclick={() => onSelectWorkspace(ws)}
					class="w-full text-left px-2.5 py-1.5 rounded text-xs font-mono transition flex items-center justify-between cursor-pointer {ws === activeWs ? 'bg-zinc-800 text-zinc-100 font-semibold' : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-300'}"
				>
					<span class="truncate">{ws}</span>
					{#if ws === activeWs}
						<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
					{/if}
				</button>
			{:else}
				<div class="text-[11px] text-zinc-600 italic py-2 text-center font-mono">No workspaces yet. Click Clone to add one.</div>
			{/each}
		</div>
	</div>

	<!-- Active Repo Status -->
	{#if wsDetails}
		<div class="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3.5 flex flex-col gap-2 text-xs">
			<div class="flex items-center justify-between font-mono">
				<div class="flex items-center gap-1.5 text-zinc-300">
					<GitBranch class="w-3 h-3 text-zinc-400" />
					<span class="font-semibold">{wsDetails.branch}</span>
				</div>
				<span class="text-[10px] px-1.5 py-0.5 rounded font-mono {wsDetails.clean ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-300 border border-amber-500/20'}">
					{wsDetails.statusSummary}
				</span>
			</div>

			<div class="text-[11px] text-zinc-500 flex justify-between pt-1 border-t border-zinc-800/60 font-mono">
				<span>Tracked Files</span>
				<span class="text-zinc-300">{wsDetails.files.length}</span>
			</div>
		</div>
	{/if}
</div>
