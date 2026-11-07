<script lang="ts">
	import { Play, RefreshCw, Layers, Clock, Plus, GitBranch, Folder, GitMerge, X, Terminal } from 'lucide-svelte';
	import { detectTaskType } from '../types';
	import type { AIModelConfig } from '../types';

	interface Props {
		prompt: string;
		branch: string;
		provider: string;
		activeWs?: string;
		workspaces?: string[];
		models?: AIModelConfig[];
		selectedTaskId: string | null;
		isExecuting: boolean;
		onExecute: () => void;
		onClearSelected: () => void;
		onSelectWorkspace?: (ws: string) => void;
	}

	let {
		prompt = $bindable(),
		branch = $bindable(),
		provider = $bindable(),
		activeWs = 'all',
		workspaces = [],
		models = [],
		selectedTaskId,
		isExecuting,
		onExecute,
		onClearSelected,
		onSelectWorkspace
	}: Props = $props();

	let showBranchInput = $state<boolean>(false);

	let activeModels = $derived(models.filter(m => m.active));
	let projectWorkspaces = $derived(workspaces.filter(w => !w.startsWith('temp-')));
	let isWorkspaceActive = $derived(Boolean(activeWs && activeWs !== 'all' && activeWs !== 'auto-temp'));

	function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			onExecute();
		}
	}
</script>

<div class="rounded-xl border border-zinc-800/90 bg-zinc-900/40 p-3.5 flex flex-col gap-3">
	{#if selectedTaskId}
		<div class="flex items-center justify-between px-3 py-1.5 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-xs">
			<div class="flex items-center gap-2 text-zinc-300">
				<Clock class="size-3.5 text-zinc-400 shrink-0" strokeWidth={1.5} />
				<span>Viewing task from history</span>
			</div>
			<button 
				onclick={onClearSelected}
				class="px-2 py-0.5 rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-200 border border-zinc-600 text-[11px] transition-colors font-medium flex items-center gap-1 cursor-pointer shrink-0"
			>
				<Plus class="size-3" strokeWidth={1.5} />
				<span>New task</span>
			</button>
		</div>
	{/if}

	<!-- Top Row: Prompt Label + Workspace Selector + Provider Segmented Control -->
	<div class="flex items-center justify-between text-xs flex-wrap gap-2">
		<div class="flex items-center gap-2 flex-wrap">
			<span class="font-medium text-zinc-200 text-xs">Prompt</span>

			<!-- Single Clean Workspace Selector -->
			{#if isWorkspaceActive}
				<div class="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-200 border border-zinc-700 text-[11px] font-mono">
					<Folder class="size-3 text-zinc-400 shrink-0" strokeWidth={1.5} />
					<span>{activeWs}</span>
					{#if onSelectWorkspace}
						<button
							onclick={() => onSelectWorkspace('all')}
							title="Untick workspace (run without workspace)"
							class="text-zinc-400 hover:text-zinc-100 transition-colors ml-0.5 cursor-pointer"
						>
							<X class="size-3" strokeWidth={1.5} />
						</button>
					{/if}
				</div>
			{:else if onSelectWorkspace && projectWorkspaces.length > 0}
				<select
					value={activeWs}
					onchange={(e) => onSelectWorkspace((e.currentTarget as HTMLSelectElement).value)}
					class="bg-zinc-950 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-700 rounded-md px-2 py-0.5 text-[11px] font-mono focus:outline-none cursor-pointer transition-colors"
					title="Target workspace"
				>
					<option value="all">Workspace: None</option>
					{#each projectWorkspaces as ws}
						<option value={ws}>{ws}</option>
					{/each}
				</select>
			{/if}

			{#if prompt.trim()}
				{@const taskType = detectTaskType(prompt)}
				<span class="text-[10px] px-1.5 py-0.2 rounded font-mono border border-zinc-800 bg-zinc-950 text-zinc-400">
					{taskType === 'code' ? 'Code' : 'Analysis'}
				</span>
			{/if}
		</div>

		<!-- Segmented Control: Choose Provider -->
		<div class="flex rounded-lg bg-zinc-950 p-0.5 border border-zinc-800 text-[11px] font-medium flex-wrap gap-0.5">
			{#if activeModels.length > 0}
				{#each activeModels as m}
					<button 
						onclick={() => (provider = m.id)}
						class="px-2.5 py-1 rounded-md transition-colors cursor-pointer {provider === m.id ? 'bg-zinc-800 text-zinc-100 font-medium border border-zinc-700' : 'text-zinc-400 hover:text-zinc-200'}"
					>
						{m.badge || m.name}
					</button>
				{/each}
			{:else}
				<button 
					onclick={() => (provider = 'codex')}
					class="px-2.5 py-1 rounded-md transition-colors cursor-pointer {provider === 'codex' ? 'bg-zinc-800 text-zinc-100 font-medium border border-zinc-700' : 'text-zinc-400 hover:text-zinc-200'}"
				>
					Codex
				</button>
				<button 
					onclick={() => (provider = 'deepseek')}
					class="px-2.5 py-1 rounded-md transition-colors cursor-pointer {provider === 'deepseek' ? 'bg-zinc-800 text-zinc-100 font-medium border border-zinc-700' : 'text-zinc-400 hover:text-zinc-200'}"
				>
					DeepSeek R1
				</button>
			{/if}

			<button 
				onclick={() => (provider = 'both')}
				class="px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer {provider === 'both' ? 'bg-zinc-800 text-zinc-100 font-medium border border-zinc-700' : 'text-zinc-400 hover:text-zinc-200'}"
			>
				<Layers class="size-3 text-zinc-400" strokeWidth={1.5} />
				<span>Dual Compare</span>
			</button>

			<button 
				onclick={() => (provider = 'consensus')}
				class="px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer {provider === 'consensus' ? 'bg-zinc-800 text-zinc-100 font-medium border border-zinc-700' : 'text-zinc-400 hover:text-zinc-200'}"
			>
				<GitMerge class="size-3 text-zinc-400" strokeWidth={1.5} />
				<span>Consensus</span>
			</button>
		</div>
	</div>

	<!-- Prompt Textarea -->
	<textarea 
		bind:value={prompt}
		onkeydown={handleKeydown}
		rows="3"
		placeholder="Ask a question, describe a change, or provide instructions... (⌘Enter to run)"
		class="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-zinc-600 resize-y font-sans placeholder:text-zinc-500 leading-relaxed"
	></textarea>

	<!-- Bottom Action Bar -->
	<div class="flex items-center justify-between gap-3 pt-0.5 flex-wrap">
		<div class="flex items-center gap-2">
			<button
				type="button"
				onclick={() => (showBranchInput = !showBranchInput)}
				class="text-[11px] px-2.5 py-1 rounded-md bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1.5 cursor-pointer font-mono"
			>
				<GitBranch class="size-3 text-zinc-500" strokeWidth={1.5} />
				<span>{branch ? `Branch: ${branch}` : 'Branch: auto'}</span>
			</button>

			{#if showBranchInput}
				<input 
					type="text" 
					bind:value={branch}
					placeholder={provider === 'both' ? 'agent/codex-* & agent/deepseek-*' : 'git branch name'}
					class="px-2.5 py-1 bg-zinc-950 border border-zinc-700 rounded-md text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-500 placeholder:text-zinc-600 w-56"
				/>
			{/if}
		</div>

		<button 
			onclick={onExecute}
			disabled={isExecuting || !prompt.trim()}
			class="h-8 px-4 rounded-lg bg-zinc-100 hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 font-medium text-xs transition-colors flex items-center gap-2 cursor-pointer shrink-0"
		>
			{#if isExecuting}
				<RefreshCw class="size-3 animate-spin" strokeWidth={1.5} />
				<span>Executing...</span>
			{:else}
				<Play class="size-3 fill-current" strokeWidth={1.5} />
				<span>Run</span>
				<kbd class="text-[10px] opacity-60 font-mono">⌘↵</kbd>
			{/if}
		</button>
	</div>
</div>
