<script lang="ts">
	import { Play, RefreshCw, Layers, Clock, Plus, Code, Sparkles } from 'lucide-svelte';
	import { detectTaskType } from '../types';
	import type { AIModelConfig } from '../types';

	interface Props {
		prompt: string;
		branch: string;
		provider: string;
		models?: AIModelConfig[];
		selectedTaskId: string | null;
		isExecuting: boolean;
		onExecute: () => void;
		onClearSelected: () => void;
	}

	let {
		prompt = $bindable(),
		branch = $bindable(),
		provider = $bindable(),
		models = [],
		selectedTaskId,
		isExecuting,
		onExecute,
		onClearSelected
	}: Props = $props();

	let activeModels = $derived(models.filter(m => m.active));

	function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			onExecute();
		}
	}
</script>

<div class="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 flex flex-col gap-3">
	{#if selectedTaskId}
		<div class="flex items-center justify-between px-3 py-1.5 rounded-md bg-zinc-950/80 border border-zinc-800 text-xs">
			<div class="flex items-center gap-1.5 text-zinc-300">
				<Clock class="w-3.5 h-3.5 text-amber-400" />
				<span class="text-zinc-400">Viewing archived task run</span>
			</div>
			<button 
				onclick={onClearSelected}
				class="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] transition font-medium flex items-center gap-1 cursor-pointer"
			>
				<Plus class="w-3 h-3" />
				<span>New Task</span>
			</button>
		</div>
	{/if}

	<div class="flex items-center justify-between text-xs flex-wrap gap-2">
		<div class="flex items-center gap-2">
			<span class="font-medium text-zinc-300">Prompt</span>
			{#if prompt.trim()}
				{@const taskType = detectTaskType(prompt)}
				<span class="text-[10px] px-2 py-0.5 rounded-full font-mono flex items-center gap-1 transition {taskType === 'code' ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-800/60' : 'bg-amber-950/80 text-amber-300 border border-amber-800/60'}">
					{#if taskType === 'code'}
						<Code class="w-2.5 h-2.5" />
						<span>Code Task</span>
					{:else}
						<Sparkles class="w-2.5 h-2.5" />
						<span>General / Planning</span>
					{/if}
				</span>
			{/if}
		</div>

		<!-- Segmented Control: Choose Provider -->
		<div class="flex rounded-md bg-zinc-950 p-0.5 border border-zinc-800 text-[11px] font-medium flex-wrap gap-0.5">
			{#if activeModels.length > 0}
				{#each activeModels as m}
					<button 
						onclick={() => (provider = m.id)}
						class="px-2.5 py-1 rounded transition cursor-pointer {provider === m.id ? 'bg-zinc-800 text-zinc-100 font-semibold border border-zinc-700' : 'text-zinc-500 hover:text-zinc-300'}"
					>
						{m.badge || m.name}
					</button>
				{/each}
			{:else}
				<button 
					onclick={() => (provider = 'codex')}
					class="px-2.5 py-1 rounded transition cursor-pointer {provider === 'codex' ? 'bg-zinc-800 text-zinc-100 font-semibold' : 'text-zinc-500 hover:text-zinc-300'}"
				>
					Codex (ChatGPT)
				</button>
				<button 
					onclick={() => (provider = 'deepseek')}
					class="px-2.5 py-1 rounded transition cursor-pointer {provider === 'deepseek' ? 'bg-zinc-800 text-zinc-100 font-semibold' : 'text-zinc-500 hover:text-zinc-300'}"
				>
					DeepSeek R1
				</button>
			{/if}

			<button 
				onclick={() => (provider = 'both')}
				class="px-2.5 py-1 rounded transition flex items-center gap-1 cursor-pointer {provider === 'both' ? 'bg-indigo-600 text-white font-semibold' : 'text-zinc-500 hover:text-zinc-300'}"
			>
				<Layers class="w-3 h-3" />
				<span>Both (Compare)</span>
			</button>
			<button 
				onclick={() => (provider = 'consensus')}
				class="px-2.5 py-1 rounded transition flex items-center gap-1 cursor-pointer {provider === 'consensus' ? 'bg-gradient-to-r from-amber-500 to-indigo-600 text-white font-semibold' : 'text-zinc-500 hover:text-zinc-300'}"
			>
				<Sparkles class="w-3 h-3" />
				<span>Consensus (Loop)</span>
			</button>
		</div>
	</div>

	<textarea 
		bind:value={prompt}
		onkeydown={handleKeydown}
		rows="3"
		placeholder="What should the agent(s) do? (⌘+Enter to execute)"
		class="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-zinc-700 resize-none font-mono placeholder:text-zinc-600 leading-relaxed"
	></textarea>

	<div class="flex items-center justify-between gap-3 pt-0.5">
		<input 
			type="text" 
			bind:value={branch}
			placeholder={provider === 'both' ? 'Branches: agent/codex-* & agent/deepseek-*' : 'Branch: auto (or specify)'}
			class="px-2.5 py-1 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-zinc-300 focus:outline-none focus:border-zinc-700 placeholder:text-zinc-600 flex-1 max-w-sm"
		/>

		<button 
			onclick={onExecute}
			disabled={isExecuting || !prompt.trim()}
			class="px-4 py-1.5 rounded-lg bg-zinc-100 hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 font-semibold text-xs transition flex items-center gap-1.5 cursor-pointer shrink-0"
		>
			{#if isExecuting}
				<RefreshCw class="w-3 h-3 animate-spin" />
				<span>{provider === 'both' ? 'Running Both...' : 'Executing...'}</span>
			{:else}
				<Play class="w-3 h-3 fill-current" />
				<span>{provider === 'both' ? 'Run Dual Agents' : 'Execute'}</span>
			{/if}
		</button>
	</div>
</div>
