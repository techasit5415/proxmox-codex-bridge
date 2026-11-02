<script lang="ts">
	import { Brain, Search, Copy, Check, FileCode, Sparkles } from 'lucide-svelte';
	import type { TaskResult, WorkspaceDetails, ConsensusData } from '../types';
	import DualCompareView from './DualCompareView.svelte';
	import SingleResultView from './SingleResultView.svelte';
	import ConsensusView from './ConsensusView.svelte';

	interface Props {
		singleResult: TaskResult | null;
		dualCodex: TaskResult | null;
		dualDeepSeek: TaskResult | null;
		consensusResult?: ConsensusData | null;
		wsDetails: WorkspaceDetails | null;
		terminalLogs: string;
		taskBadge: string;
		taskBadgeType: 'idle' | 'running' | 'success' | 'error';
	}

	let {
		singleResult,
		dualCodex,
		dualDeepSeek,
		consensusResult = null,
		wsDetails,
		terminalLogs,
		taskBadge,
		taskBadgeType
	}: Props = $props();

	let activeTab = $state<'thoughts' | 'diff' | 'deepseek_diff' | 'logs' | 'files'>('thoughts');
	let activeModelView = $state<'split' | 'codex' | 'deepseek'>('split');
	let searchQuery = $state<string>('');
	let logFilter = $state<'all' | 'thoughts' | 'exec' | 'error'>('all');
	let copied = $state<boolean>(false);

	function getCurrentDiff(): string {
		if (consensusResult) {
			return consensusResult.finalSolution?.diff || '';
		}
		if (dualCodex && dualDeepSeek) {
			return activeTab === 'deepseek_diff' ? dualDeepSeek.diff : dualCodex.diff;
		}
		return singleResult?.diff || '';
	}

	function copyCurrentDiff() {
		const d = getCurrentDiff();
		if (!d) return;
		navigator.clipboard.writeText(d);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	function getActiveRawLogs(): string {
		if (dualCodex && dualDeepSeek) {
			return `=== CODEX LOGS ===\n${dualCodex.logs}\n\n=== DEEPSEEK R1 LOGS ===\n${dualDeepSeek.logs}`;
		}
		return singleResult?.logs || terminalLogs || '';
	}

	function getFilteredLogLines(text: string): { line: string; matched: boolean }[] {
		if (!text) return [];
		const lines = text.split('\n');
		const q = searchQuery.toLowerCase().trim();

		return lines.map(line => {
			const lower = line.toLowerCase();
			let matchFilter = true;
			if (logFilter === 'thoughts') matchFilter = lower.includes('think') || lower.includes('plan') || lower.includes('i will') || lower.includes('i’ll');
			else if (logFilter === 'exec') matchFilter = lower.includes('exec') || lower.includes('$') || lower.includes('/bin/bash') || lower.includes('rg');
			else if (logFilter === 'error') matchFilter = lower.includes('error') || lower.includes('fail');

			const matchSearch = q ? lower.includes(q) : true;
			return {
				line,
				matched: matchFilter && matchSearch
			};
		}).filter(item => item.matched);
	}
</script>

<div class="rounded-lg border border-zinc-800 bg-zinc-900/30 flex-1 flex flex-col overflow-hidden min-h-[480px]">
	<!-- Header Tabs -->
	<div class="flex items-center justify-between border-b border-zinc-800 px-3 bg-zinc-950">
		<div class="flex items-center overflow-x-auto text-xs">
			<button 
				onclick={() => (activeTab = 'thoughts')}
				class="px-3 py-2.5 font-medium border-b-2 transition shrink-0 flex items-center gap-1.5 cursor-pointer {activeTab === 'thoughts' ? 'border-violet-400 text-violet-300' : 'border-transparent text-zinc-500 hover:text-zinc-300'}"
			>
				<Brain class="w-3.5 h-3.5" />
				<span>Response & Reasoning</span>
			</button>

			{#if dualCodex && dualDeepSeek}
				<button 
					onclick={() => (activeTab = 'diff')}
					class="px-3 py-2.5 font-medium border-b-2 transition shrink-0 cursor-pointer {activeTab === 'diff' ? 'border-zinc-200 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'}"
				>
					Codex Diff ({dualCodex.branch})
				</button>
				<button 
					onclick={() => (activeTab = 'deepseek_diff')}
					class="px-3 py-2.5 font-medium border-b-2 transition shrink-0 cursor-pointer {activeTab === 'deepseek_diff' ? 'border-violet-400 text-violet-300' : 'border-transparent text-zinc-500 hover:text-zinc-300'}"
				>
					DeepSeek Diff ({dualDeepSeek.branch})
				</button>
			{:else}
				<button 
					onclick={() => (activeTab = 'diff')}
					class="px-3.5 py-2.5 font-medium border-b-2 transition cursor-pointer {activeTab === 'diff' ? 'border-zinc-200 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'}"
				>
					Git Diff {singleResult?.branch ? `(${singleResult.branch})` : ''}
				</button>
			{/if}

			<button 
				onclick={() => (activeTab = 'logs')}
				class="px-3.5 py-2.5 font-medium border-b-2 transition shrink-0 cursor-pointer {activeTab === 'logs' ? 'border-zinc-200 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'}"
			>
				Raw Logs
			</button>
			
			<button 
				onclick={() => (activeTab = 'files')}
				class="px-3.5 py-2.5 font-medium border-b-2 transition shrink-0 cursor-pointer {activeTab === 'files' ? 'border-zinc-200 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'}"
			>
				Files & History
			</button>
		</div>

		<div class="flex items-center gap-3">
			{#if (activeTab === 'diff' || activeTab === 'deepseek_diff') && getCurrentDiff()}
				<button 
					onclick={copyCurrentDiff}
					class="text-[11px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center gap-1 transition font-mono cursor-pointer"
				>
					{#if copied}
						<Check class="w-3 h-3 text-emerald-400" />
						<span>Copied</span>
					{:else}
						<Copy class="w-3 h-3" />
						<span>Copy</span>
					{/if}
				</button>
			{/if}
			<span class="text-[11px] font-mono {taskBadgeType === 'running' ? 'text-amber-400 animate-pulse' : taskBadgeType === 'success' ? 'text-emerald-400' : taskBadgeType === 'error' ? 'text-rose-400' : 'text-zinc-500'}">
				{taskBadge}
			</span>
		</div>
	</div>

	<!-- Search & Filter Toolbar (for Thoughts and Logs) -->
	{#if activeTab === 'thoughts' || activeTab === 'logs'}
		<div class="px-3 py-2 bg-zinc-950/80 border-b border-zinc-800/80 flex items-center justify-between gap-3 text-xs flex-wrap">
			<!-- Search Box -->
			<div class="relative flex-1 min-w-[200px]">
				<Search class="w-3.5 h-3.5 absolute left-2.5 top-2 text-zinc-500" />
				<input 
					type="text" 
					bind:value={searchQuery}
					placeholder="Search thoughts, commands, files, or errors..."
					class="w-full pl-8 pr-3 py-1 bg-zinc-900 border border-zinc-800 rounded text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-700 placeholder:text-zinc-600"
				/>
				{#if searchQuery}
					<button onclick={() => (searchQuery = '')} class="absolute right-2.5 top-1.5 text-zinc-500 hover:text-zinc-300 text-[11px] cursor-pointer">&times;</button>
				{/if}
			</div>

			<!-- Filter Pills -->
			<div class="flex items-center gap-1 text-[11px]">
				<button 
					onclick={() => (logFilter = 'all')}
					class="px-2 py-0.5 rounded transition cursor-pointer {logFilter === 'all' ? 'bg-zinc-800 text-zinc-100 font-semibold' : 'text-zinc-500 hover:text-zinc-300'}"
				>
					All
				</button>
				<button 
					onclick={() => (logFilter = 'thoughts')}
					class="px-2 py-0.5 rounded transition cursor-pointer {logFilter === 'thoughts' ? 'bg-violet-950/60 text-violet-300 border border-violet-800/60 font-semibold' : 'text-zinc-500 hover:text-zinc-300'}"
				>
					Thoughts
				</button>
				<button 
					onclick={() => (logFilter = 'exec')}
					class="px-2 py-0.5 rounded transition cursor-pointer {logFilter === 'exec' ? 'bg-cyan-950/60 text-cyan-300 border border-cyan-800/60 font-semibold' : 'text-zinc-500 hover:text-zinc-300'}"
				>
					Exec/Commands
				</button>
				<button 
					onclick={() => (logFilter = 'error')}
					class="px-2 py-0.5 rounded transition cursor-pointer {logFilter === 'error' ? 'bg-rose-950/60 text-rose-300 border border-rose-800/60 font-semibold' : 'text-zinc-500 hover:text-zinc-300'}"
				>
					Errors
				</button>
			</div>
		</div>
	{/if}

	<!-- Tab Content Area -->
	<div class="p-3.5 flex-1 overflow-auto bg-zinc-950 font-mono text-xs">
		<!-- RESPONSE & REASONING TAB -->
		{#if activeTab === 'thoughts'}
			{#if consensusResult}
				<ConsensusView consensus={consensusResult} />
			{:else if dualCodex && dualDeepSeek}
				<DualCompareView 
					codex={dualCodex} 
					deepseek={dualDeepSeek} 
					{activeModelView} 
					onChangeModelView={(v) => (activeModelView = v)} 
				/>
			{:else if singleResult}
				<SingleResultView 
					result={singleResult} 
					onViewDiffTab={() => (activeTab = 'diff')} 
				/>
			{:else}
				<div class="text-zinc-500 italic py-6 text-center font-mono">No active task or results yet. Enter a prompt above to execute.</div>
			{/if}

		<!-- DIFF TAB -->
		{:else if activeTab === 'diff'}
			<pre class="text-zinc-200 whitespace-pre-wrap leading-relaxed">{consensusResult ? (consensusResult.finalSolution?.diff || '(No diff recorded)') : (dualCodex ? dualCodex.diff : (singleResult?.diff || '(No diff recorded)'))}</pre>

		<!-- DEEPSEEK DIFF TAB -->
		{:else if activeTab === 'deepseek_diff'}
			<pre class="text-violet-200 whitespace-pre-wrap leading-relaxed">{dualDeepSeek?.diff || '(No diff recorded)'}</pre>

		<!-- RAW LOGS TAB -->
		{:else if activeTab === 'logs'}
			<div class="flex flex-col gap-0.5">
				{#each getFilteredLogLines(getActiveRawLogs()) as item}
					<div class="py-0.5 px-1.5 rounded transition {item.line.includes('exec') ? 'text-cyan-300' : item.line.includes('error') ? 'text-rose-400' : 'text-zinc-300'}">
						{item.line}
					</div>
				{:else}
					<div class="text-zinc-600 italic py-2">No logs matching filter.</div>
				{/each}
			</div>

		<!-- FILES & COMMITS TAB -->
		{:else if activeTab === 'files' && wsDetails}
			<div class="flex flex-col gap-3.5 text-zinc-300 font-sans">
				<div>
					<div class="text-zinc-500 text-[10px] uppercase tracking-wider mb-1 font-semibold font-mono">Commits</div>
					<div class="space-y-1 p-2.5 bg-zinc-900/40 rounded border border-zinc-800/80 font-mono text-xs">
						{#each wsDetails.recentCommits as commit}
							<div class="text-zinc-300 truncate">{commit}</div>
						{:else}
							<div class="text-zinc-600 italic">No recent commits.</div>
						{/each}
					</div>
				</div>
				<div>
					<div class="text-zinc-500 text-[10px] uppercase tracking-wider mb-1 font-semibold font-mono">Files</div>
					<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 font-mono text-xs">
						{#each wsDetails.files as file}
							<div class="px-2 py-1 bg-zinc-900/40 rounded border border-zinc-800 text-[11px] truncate text-zinc-400 flex items-center gap-1">
								<FileCode class="w-3 h-3 text-zinc-600 shrink-0" />
								<span class="truncate">{file}</span>
							</div>
						{:else}
							<div class="text-zinc-600 italic">No tracked files.</div>
						{/each}
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>
