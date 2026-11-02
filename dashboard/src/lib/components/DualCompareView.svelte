<script lang="ts">
	import { Layers } from 'lucide-svelte';
	import type { TaskResult } from '$lib/types';
	import { fmtTokens, extractThoughtAndBody } from '$lib/types';
	import ChainOfThought from './ChainOfThought.svelte';
	import DiffViewer from './DiffViewer.svelte';

	interface Props {
		codex: TaskResult;
		deepseek: TaskResult;
		activeModelView: 'split' | 'codex' | 'deepseek';
		onChangeModelView: (view: 'split' | 'codex' | 'deepseek') => void;
	}

	let { codex, deepseek, activeModelView, onChangeModelView }: Props = $props();

	let codexParsed = $derived(extractThoughtAndBody(codex.logs));
	let deepseekParsed = $derived(extractThoughtAndBody(deepseek.logs));
</script>

<!-- Dual Model Switcher Toolbar -->
<div class="mb-3.5 flex items-center justify-between gap-3 p-2 bg-zinc-900/60 rounded-lg border border-zinc-800 text-xs font-mono flex-wrap">
	<div class="flex items-center gap-2">
		<span class="text-zinc-400 text-[11px] font-sans">Model View:</span>
		<div class="flex rounded-md bg-zinc-950 p-0.5 border border-zinc-800 text-[11px]">
			<button 
				onclick={() => onChangeModelView('split')}
				class="px-2.5 py-1 rounded transition flex items-center gap-1.5 cursor-pointer {activeModelView === 'split' ? 'bg-indigo-600 text-white font-semibold shadow-xs' : 'text-zinc-400 hover:text-zinc-200'}"
			>
				<Layers class="w-3 h-3" />
				<span>Side-by-Side (Compare)</span>
			</button>
			<button 
				onclick={() => onChangeModelView('codex')}
				class="px-2.5 py-1 rounded transition flex items-center gap-1.5 cursor-pointer {activeModelView === 'codex' ? 'bg-zinc-800 text-emerald-300 font-semibold border border-zinc-700 shadow-xs' : 'text-zinc-400 hover:text-zinc-200'}"
			>
				<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
				<span>Codex</span>
			</button>
			<button 
				onclick={() => onChangeModelView('deepseek')}
				class="px-2.5 py-1 rounded transition flex items-center gap-1.5 cursor-pointer {activeModelView === 'deepseek' ? 'bg-violet-950 text-violet-300 border border-violet-800 font-semibold shadow-xs' : 'text-zinc-400 hover:text-zinc-200'}"
			>
				<span class="w-1.5 h-1.5 rounded-full bg-violet-400"></span>
				<span>DeepSeek R1</span>
			</button>
		</div>
	</div>

	<!-- Quick Tokens Summary -->
	<div class="flex items-center gap-2 text-[11px]">
		<span class="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-emerald-400">
			Codex: {fmtTokens(codex.tokens?.total_tokens)} tok
		</span>
		<span class="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-violet-400">
			DeepSeek: {fmtTokens(deepseek.tokens?.total_tokens)} tok
		</span>
	</div>
</div>

<!-- View: Side-by-Side Split -->
{#if activeModelView === 'split'}
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 font-sans text-xs">
		<!-- LEFT: Codex Column -->
		<div class="flex flex-col gap-2.5">
			<div class="p-2.5 rounded-t-lg bg-zinc-900 border border-zinc-800 flex items-center justify-between font-mono">
				<div class="flex items-center gap-2">
					<span class="w-2 h-2 rounded-full bg-emerald-400"></span>
					<span class="font-bold text-zinc-100 text-xs">Codex (gpt-6.1-sol)</span>
					<span class="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">{codex.branch}</span>
				</div>
				<span class="text-[11px] text-zinc-400">{fmtTokens(codex.tokens?.total_tokens)} tok</span>
			</div>

			<div class="rounded-b-lg border-x border-b border-zinc-800 bg-zinc-900/40 p-3.5 flex flex-col gap-2">
				<div class="text-zinc-200 whitespace-pre-wrap leading-relaxed font-mono text-xs select-text">
					{codexParsed.body || codex.logs || '(No output recorded)'}
				</div>
			</div>

			<DiffViewer diff={codex.diff} branch={codex.branch} providerColor="emerald" collapsible={true} />
		</div>

		<!-- RIGHT: DeepSeek R1 Column -->
		<div class="flex flex-col gap-2.5">
			<div class="p-2.5 rounded-t-lg bg-violet-950/60 border border-violet-900/60 flex items-center justify-between font-mono">
				<div class="flex items-center gap-2">
					<span class="w-2 h-2 rounded-full bg-violet-400"></span>
					<span class="font-bold text-violet-200 text-xs">DeepSeek R1 (14b GPU)</span>
					<span class="text-[10px] px-1.5 py-0.2 rounded bg-violet-900/60 text-violet-300">{deepseek.branch}</span>
				</div>
				<span class="text-[11px] text-violet-300">{fmtTokens(deepseek.tokens?.total_tokens)} tok</span>
			</div>

			{#if deepseekParsed.thoughts}
				<ChainOfThought thoughts={deepseekParsed.thoughts} defaultExpanded={false} />
			{/if}

			<div class="rounded-b-lg border-x border-b border-zinc-800 bg-zinc-900/40 p-3.5 flex flex-col gap-2">
				<div class="text-zinc-200 whitespace-pre-wrap leading-relaxed font-mono text-xs select-text">
					{deepseekParsed.body || deepseek.logs || '(No output recorded)'}
				</div>
			</div>

			<DiffViewer diff={deepseek.diff} branch={deepseek.branch} providerColor="violet" collapsible={true} />
		</div>
	</div>

<!-- View: Codex Only -->
{:else if activeModelView === 'codex'}
	<div class="flex flex-col gap-3 font-sans text-xs">
		<div class="p-3 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-between font-mono">
			<div class="flex items-center gap-2">
				<span class="w-2 h-2 rounded-full bg-emerald-400"></span>
				<span class="font-bold text-zinc-100 text-xs">Codex (gpt-6.1-sol)</span>
				<span class="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">{codex.branch}</span>
			</div>
			<span class="text-[11px] text-zinc-400">{fmtTokens(codex.tokens?.total_tokens)} tokens</span>
		</div>

		<div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-2.5">
			<div class="text-zinc-200 whitespace-pre-wrap leading-relaxed font-mono text-xs select-text">
				{codexParsed.body || codex.logs}
			</div>
		</div>

		<DiffViewer diff={codex.diff} branch={codex.branch} providerColor="emerald" collapsible={false} />
	</div>

<!-- View: DeepSeek R1 Only -->
{:else if activeModelView === 'deepseek'}
	<div class="flex flex-col gap-3 font-sans text-xs">
		<div class="p-3 rounded-lg bg-violet-950/60 border border-violet-900/60 flex items-center justify-between font-mono">
			<div class="flex items-center gap-2">
				<span class="w-2 h-2 rounded-full bg-violet-400"></span>
				<span class="font-bold text-violet-200 text-xs">DeepSeek R1 (14b GPU)</span>
				<span class="text-[10px] px-1.5 py-0.2 rounded bg-violet-900/60 text-violet-300">{deepseek.branch}</span>
			</div>
			<span class="text-[11px] text-violet-300">{fmtTokens(deepseek.tokens?.total_tokens)} tokens</span>
		</div>

		{#if deepseekParsed.thoughts}
			<ChainOfThought thoughts={deepseekParsed.thoughts} defaultExpanded={false} />
		{/if}

		<div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-2.5">
			<div class="text-zinc-200 whitespace-pre-wrap leading-relaxed font-mono text-xs select-text">
				{deepseekParsed.body || deepseek.logs}
			</div>
		</div>

		<DiffViewer diff={deepseek.diff} branch={deepseek.branch} providerColor="violet" collapsible={false} />
	</div>
{/if}
