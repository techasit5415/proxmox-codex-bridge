<script lang="ts">
	import { Sparkles, Layers, MessageSquareCode, CheckCircle2, Bot, Brain } from 'lucide-svelte';
	import type { ConsensusData } from '../types';
	import { fmtTokens, extractThoughtAndBody } from '../types';
	import ChainOfThought from './ChainOfThought.svelte';
	import DiffViewer from './DiffViewer.svelte';

	interface Props {
		consensus: ConsensusData;
	}

	let { consensus }: Props = $props();

	let activeConsensusTab = $state<'solution' | 'reviews' | 'proposals'>('solution');

	let finalParsed = $derived(extractThoughtAndBody(consensus.finalSolution?.logs || ''));
	let codexPropParsed = $derived(extractThoughtAndBody(consensus.codexProposal?.logs || ''));
	let deepseekPropParsed = $derived(extractThoughtAndBody(consensus.deepseekProposal?.logs || ''));
	let deepseekRevParsed = $derived(extractThoughtAndBody(consensus.deepseekReviewOfCodex || ''));
	let codexRevParsed = $derived(extractThoughtAndBody(consensus.codexReviewOfDeepSeek || ''));
</script>

<!-- Consensus Mode Header & Tab Switcher -->
<div class="mb-3.5 flex items-center justify-between gap-3 p-2.5 bg-gradient-to-r from-amber-950/40 via-zinc-900 to-indigo-950/40 rounded-lg border border-amber-800/40 text-xs font-mono flex-wrap">
	<div class="flex items-center gap-2">
		<span class="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold flex items-center gap-1">
			<Sparkles class="w-3 h-3 text-amber-400" />
			<span>Multi-Agent Consensus</span>
		</span>

		<div class="flex rounded-md bg-zinc-950 p-0.5 border border-zinc-800 text-[11px]">
			<button 
				onclick={() => (activeConsensusTab = 'solution')}
				class="px-2.5 py-1 rounded transition flex items-center gap-1.5 cursor-pointer {activeConsensusTab === 'solution' ? 'bg-amber-600 text-white font-semibold shadow-xs' : 'text-zinc-400 hover:text-zinc-200'}"
			>
				<CheckCircle2 class="w-3 h-3 text-amber-200" />
				<span>1. Final Consensus</span>
			</button>
			<button 
				onclick={() => (activeConsensusTab = 'reviews')}
				class="px-2.5 py-1 rounded transition flex items-center gap-1.5 cursor-pointer {activeConsensusTab === 'reviews' ? 'bg-indigo-600 text-white font-semibold shadow-xs' : 'text-zinc-400 hover:text-zinc-200'}"
			>
				<MessageSquareCode class="w-3 h-3 text-indigo-200" />
				<span>2. Peer Reviews (Cross Audit)</span>
			</button>
			<button 
				onclick={() => (activeConsensusTab = 'proposals')}
				class="px-2.5 py-1 rounded transition flex items-center gap-1.5 cursor-pointer {activeConsensusTab === 'proposals' ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-xs' : 'text-zinc-400 hover:text-zinc-200'}"
			>
				<Layers class="w-3 h-3" />
				<span>3. Initial Proposals</span>
			</button>
		</div>
	</div>

	<!-- Token Statistics -->
	<div class="flex items-center gap-2 text-[10px]">
		<span class="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-400">
			Harmonized in <span class="text-amber-400 font-bold">{consensus.finalSolution?.branch || 'consensus'}</span>
		</span>
	</div>
</div>

<!-- TAB 1: FINAL HARMONIZED SOLUTION -->
{#if activeConsensusTab === 'solution'}
	<div class="flex flex-col gap-3 font-sans text-xs">
		<div class="p-3 rounded-lg bg-zinc-900 border border-amber-900/40 flex items-center justify-between font-mono">
			<div class="flex items-center gap-2">
				<span class="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></span>
				<span class="font-bold text-amber-200 text-xs">Consensus Master Harmonization</span>
				<span class="text-[10px] px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/50">
					{consensus.finalSolution?.branch}
				</span>
			</div>
			<div class="flex items-center gap-3 text-[11px] text-zinc-400">
				<span>Status: <strong class="text-emerald-400">{consensus.finalSolution?.status || 'Clean'}</strong></span>
				<span>Tokens: {fmtTokens(consensus.finalSolution?.tokens?.total_tokens)}</span>
			</div>
		</div>

		<div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-2">
			<div class="text-zinc-200 whitespace-pre-wrap leading-relaxed font-mono text-xs select-text">
				{finalParsed.body || consensus.finalSolution?.logs || '(No output recorded)'}
			</div>
		</div>

		<DiffViewer 
			diff={consensus.finalSolution?.diff || ''} 
			branch={consensus.finalSolution?.branch || 'consensus'} 
			providerColor="amber" 
			collapsible={false} 
		/>
	</div>

<!-- TAB 2: PEER REVIEWS (CROSS AUDIT) -->
{:else if activeConsensusTab === 'reviews'}
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 font-sans text-xs">
		<!-- LEFT: DeepSeek auditing Codex -->
		<div class="flex flex-col gap-2.5">
			<div class="p-2.5 rounded-t-lg bg-violet-950/70 border border-violet-800/60 flex items-center justify-between font-mono">
				<div class="flex items-center gap-2">
					<Brain class="w-4 h-4 text-violet-400" />
					<span class="font-bold text-violet-200 text-xs">DeepSeek R1 Reviewing Codex</span>
				</div>
				<span class="text-[10px] px-1.5 py-0.5 rounded bg-violet-900/60 text-violet-300">Auditor: DeepSeek</span>
			</div>

			{#if deepseekRevParsed.thoughts}
				<ChainOfThought thoughts={deepseekRevParsed.thoughts} defaultExpanded={false} />
			{/if}

			<div class="rounded-b-lg border-x border-b border-zinc-800 bg-zinc-900/40 p-3.5">
				<div class="text-zinc-200 whitespace-pre-wrap leading-relaxed font-mono text-xs select-text">
					{deepseekRevParsed.body || consensus.deepseekReviewOfCodex || '(No review recorded)'}
				</div>
			</div>
		</div>

		<!-- RIGHT: Codex auditing DeepSeek -->
		<div class="flex flex-col gap-2.5">
			<div class="p-2.5 rounded-t-lg bg-emerald-950/70 border border-emerald-800/60 flex items-center justify-between font-mono">
				<div class="flex items-center gap-2">
					<Bot class="w-4 h-4 text-emerald-400" />
					<span class="font-bold text-emerald-200 text-xs">Codex Reviewing DeepSeek R1</span>
				</div>
				<span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-300">Auditor: Codex</span>
			</div>

			<div class="rounded-b-lg border-x border-b border-zinc-800 bg-zinc-900/40 p-3.5">
				<div class="text-zinc-200 whitespace-pre-wrap leading-relaxed font-mono text-xs select-text">
					{codexRevParsed.body || consensus.codexReviewOfDeepSeek || '(No review recorded)'}
				</div>
			</div>
		</div>
	</div>

<!-- TAB 3: INITIAL PROPOSALS -->
{:else if activeConsensusTab === 'proposals'}
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 font-sans text-xs">
		<!-- LEFT: Codex Initial Proposal -->
		<div class="flex flex-col gap-2.5">
			<div class="p-2.5 rounded-t-lg bg-zinc-900 border border-zinc-800 flex items-center justify-between font-mono">
				<div class="flex items-center gap-2">
					<span class="w-2 h-2 rounded-full bg-emerald-400"></span>
					<span class="font-bold text-zinc-100 text-xs">Codex Proposal</span>
					<span class="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">{consensus.codexProposal?.branch}</span>
				</div>
				<span class="text-[11px] text-zinc-400">{fmtTokens(consensus.codexProposal?.tokens?.total_tokens)} tok</span>
			</div>

			<div class="rounded-b-lg border-x border-b border-zinc-800 bg-zinc-900/40 p-3 flex flex-col gap-2 max-h-96 overflow-y-auto">
				<div class="text-zinc-200 whitespace-pre-wrap leading-relaxed font-mono text-xs select-text">
					{codexPropParsed.body || consensus.codexProposal?.logs || '(No output recorded)'}
				</div>
			</div>

			<DiffViewer diff={consensus.codexProposal?.diff || ''} branch={consensus.codexProposal?.branch || ''} providerColor="emerald" collapsible={true} />
		</div>

		<!-- RIGHT: DeepSeek Initial Proposal -->
		<div class="flex flex-col gap-2.5">
			<div class="p-2.5 rounded-t-lg bg-violet-950/60 border border-violet-900/60 flex items-center justify-between font-mono">
				<div class="flex items-center gap-2">
					<span class="w-2 h-2 rounded-full bg-violet-400"></span>
					<span class="font-bold text-violet-200 text-xs">DeepSeek Proposal</span>
					<span class="text-[10px] px-1.5 py-0.2 rounded bg-violet-900/60 text-violet-300">{consensus.deepseekProposal?.branch}</span>
				</div>
				<span class="text-[11px] text-violet-300">{fmtTokens(consensus.deepseekProposal?.tokens?.total_tokens)} tok</span>
			</div>

			{#if deepseekPropParsed.thoughts}
				<ChainOfThought thoughts={deepseekPropParsed.thoughts} defaultExpanded={false} />
			{/if}

			<div class="rounded-b-lg border-x border-b border-zinc-800 bg-zinc-900/40 p-3 flex flex-col gap-2 max-h-96 overflow-y-auto">
				<div class="text-zinc-200 whitespace-pre-wrap leading-relaxed font-mono text-xs select-text">
					{deepseekPropParsed.body || consensus.deepseekProposal?.logs || '(No output recorded)'}
				</div>
			</div>

			<DiffViewer diff={consensus.deepseekProposal?.diff || ''} branch={consensus.deepseekProposal?.branch || ''} providerColor="violet" collapsible={true} />
		</div>
	</div>
{/if}
