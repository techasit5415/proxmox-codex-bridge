<script lang="ts">
	import { Brain, Search, Copy, Check, FileCode, Download, ShieldCheck, ShieldAlert, Sparkles, Globe, Layers, Code, Clock, ArrowRight } from 'lucide-svelte';
	import type { TaskResult, WorkspaceDetails, ConsensusData, TestEvidence, TaskRecord } from '../types';
	import { fmtTokens, getNetTokens } from '../types';
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
		recentHistory?: TaskRecord[];
		onApplyStarter?: (starterPrompt: string, starterProvider: 'codex' | 'deepseek' | 'both' | 'consensus') => void;
		onSelectHistoryTask?: (item: TaskRecord) => void;
	}

	let {
		singleResult,
		dualCodex,
		dualDeepSeek,
		consensusResult = null,
		wsDetails,
		terminalLogs,
		taskBadge,
		taskBadgeType,
		recentHistory = [],
		onApplyStarter,
		onSelectHistoryTask
	}: Props = $props();

	let activeTab = $state<'thoughts' | 'diff' | 'deepseek_diff' | 'tests' | 'logs' | 'files'>('thoughts');
	let activeModelView = $state<'split' | 'codex' | 'deepseek'>('split');
	let searchQuery = $state<string>('');
	let logFilter = $state<'all' | 'thoughts' | 'exec' | 'error'>('all');
	let copied = $state<boolean>(false);
	let showExportMenu = $state<boolean>(false);

	let hasActiveOutput = $derived(Boolean(consensusResult || (dualCodex && dualDeepSeek) || singleResult || terminalLogs));

	const quickStarters: {
		title: string;
		desc: string;
		badge: string;
		provider: 'codex' | 'deepseek' | 'both' | 'consensus';
		prompt: string;
		color: string;
	}[] = [
		{
			title: 'วิเคราะห์ร่วม 3 โมเดล (Consensus)',
			desc: 'Codex และ DeepSeek R1 เสนอแนวทาง สลับกันตรวจ (Peer Review) แล้วสังเคราะห์ทางออกที่ดีที่สุด',
			badge: 'Consensus',
			provider: 'consensus',
			prompt: 'ช่วยออกแบบสถาปัตยกรรมและแนวทางปรับปรุงระบบสำหรับ: ',
			color: 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 text-zinc-200'
		},
		{
			title: 'วิเคราะห์คลังโค้ด GitHub อัตโนมัติ',
			desc: 'ระบุลิงก์ GitHub เพื่อให้ระบบโคลนโค้ดและดึงโครงสร้างไฟล์ให้โมเดลตรวจสอบ',
			badge: 'Clone & Analyze',
			provider: 'deepseek',
			prompt: 'ช่วยวิเคราะห์โครงสร้างโปรเจกต์ จุดเด่น และสิ่งที่ควรปรับปรุงของ https://github.com/',
			color: 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 text-zinc-200'
		},
		{
			title: 'สืบค้นข้อมูลจากเว็บสดด้วย DeepSeek R1',
			desc: 'ใช้งานค้นหาเว็บ [TOOL:WEB_SEARCH] และดึงข้อมูลปัจจุบันมาวิเคราะห์สรุปเป็นภาษาไทย',
			badge: 'Web Search',
			provider: 'deepseek',
			prompt: 'ค้นหาข้อมูลล่าสุดจากอินเทอร์เน็ตเกี่ยวกับ: ',
			color: 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 text-zinc-200'
		},
		{
			title: 'ตรวจสอบโค้ดและบั๊กแบบ Dual Compare',
			desc: 'รัน Codex และ DeepSeek R1 พร้อมกันใน Git Worktree แยกกันเพื่อเปรียบเทียบการแก้ไข',
			badge: 'Dual Compare',
			provider: 'both',
			prompt: 'ช่วยตรวจสอบโค้ดในโปรเจกต์นี้ หาช่องโหว่หรือบั๊ก และเสนอแนวทางแก้ไข',
			color: 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 text-zinc-200'
		}
	];

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

	function getTestEvidence(): TestEvidence | null {
		if (consensusResult?.testEvidence) return consensusResult.testEvidence;
		if (singleResult?.testEvidence) return singleResult.testEvidence;
		if (dualCodex?.testEvidence) return dualCodex.testEvidence;
		return null;
	}

	function exportReport(format: 'markdown' | 'patch' | 'json') {
		let filename = `agent-report-${Date.now()}`;
		let content = '';
		let mime = 'text/plain';

		if (format === 'patch') {
			filename += '.patch';
			content = getCurrentDiff();
		} else if (format === 'json') {
			filename += '.json';
			mime = 'application/json';
			content = JSON.stringify({
				singleResult,
				dualCodex,
				dualDeepSeek,
				consensusResult,
				testEvidence: getTestEvidence(),
				terminalLogs
			}, null, 2);
		} else {
			filename += '.md';
			mime = 'text/markdown';
			const test = getTestEvidence();
			content = `# Proxmox Multi-Agent Task Report\n\n` +
				`- Generated: ${new Date().toLocaleString()}\n` +
				`- Workspace: ${wsDetails?.name || 'temp'}\n\n` +
				`## Test Gate Evidence\n` +
				(test && test.ran ? `- Status: **${test.passed ? 'PASSED' : 'FAILED'}**\n- Command: \`${test.testCmd}\`\n\n\`\`\`\n${test.output}\n\`\`\`\n\n` : `_No tests executed._\n\n`) +
				`## Git Changes (Diff)\n\`\`\`diff\n${getCurrentDiff() || '(No changes)'}\n\`\`\`\n\n` +
				`## Execution Logs\n\`\`\`\n${getActiveRawLogs()}\n\`\`\`\n`;
		}

		const blob = new Blob([content], { type: mime });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
		showExportMenu = false;
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

<div class="rounded-xl border border-zinc-800/90 bg-zinc-900/40 flex-1 flex flex-col overflow-hidden min-h-[460px] shadow-sm">
	<!-- Header Tabs -->
	<div class="flex items-center justify-between border-b border-zinc-800 px-3 bg-zinc-950">
		<div class="flex items-center overflow-x-auto text-xs">
			<button 
				onclick={() => (activeTab = 'thoughts')}
				class="px-3 py-2.5 font-medium border-b-2 transition shrink-0 flex items-center gap-1.5 cursor-pointer {activeTab === 'thoughts' ? 'border-violet-400 text-violet-300' : 'border-transparent text-zinc-500 hover:text-zinc-300'}"
			>
				<Brain class="w-3.5 h-3.5" />
				<span>ผลลัพธ์ & การคิดวิเคราะห์ (Response)</span>
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

			{#if getTestEvidence()?.ran}
				<button 
					onclick={() => (activeTab = 'tests')}
					class="px-3 py-2.5 font-medium border-b-2 transition shrink-0 flex items-center gap-1.5 cursor-pointer {activeTab === 'tests' ? 'border-emerald-400 text-emerald-300' : 'border-transparent text-zinc-500 hover:text-zinc-300'}"
				>
					{#if getTestEvidence()?.passed}
						<ShieldCheck class="w-3.5 h-3.5 text-emerald-400" />
						<span>{getTestEvidence()?.type === 'syntax_check' ? 'Syntax Verified' : 'Test Gate (Passed)'}</span>
					{:else}
						<ShieldAlert class="w-3.5 h-3.5 text-rose-400" />
						<span>{getTestEvidence()?.type === 'syntax_check' ? 'Syntax Error' : 'Test Gate (Failed)'}</span>
					{/if}
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
				Files & Commits
			</button>
		</div>

		<div class="flex items-center gap-2">
			{#if hasActiveOutput}
				<!-- Export Report Button -->
				<div class="relative">
					<button 
						onclick={() => (showExportMenu = !showExportMenu)}
						class="text-[11px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center gap-1 transition font-mono cursor-pointer"
						title="Export Task Report"
					>
						<Download class="w-3 h-3 text-cyan-400" />
						<span>Export</span>
					</button>

					{#if showExportMenu}
						<div class="absolute right-0 top-7 w-44 bg-zinc-900 border border-zinc-700 rounded-md shadow-xl py-1 z-50 text-[11px] font-sans">
							<button 
								onclick={() => exportReport('markdown')}
								class="w-full text-left px-3 py-1.5 hover:bg-zinc-800 text-zinc-200 cursor-pointer flex items-center justify-between"
							>
								<span>Markdown (.md)</span>
								<span class="text-zinc-500 text-[10px]">Report</span>
							</button>
							<button 
								onclick={() => exportReport('patch')}
								class="w-full text-left px-3 py-1.5 hover:bg-zinc-800 text-zinc-200 cursor-pointer flex items-center justify-between"
							>
								<span>Git Patch (.patch)</span>
								<span class="text-zinc-500 text-[10px]">Diff</span>
							</button>
							<button 
								onclick={() => exportReport('json')}
								class="w-full text-left px-3 py-1.5 hover:bg-zinc-800 text-zinc-200 cursor-pointer flex items-center justify-between"
							>
								<span>Audit JSON (.json)</span>
								<span class="text-zinc-500 text-[10px]">Raw</span>
							</button>
						</div>
					{/if}
				</div>
			{/if}

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

			<span class="text-[11px] font-mono px-2 py-0.5 rounded {taskBadgeType === 'running' ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30 animate-pulse' : taskBadgeType === 'success' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : taskBadgeType === 'error' ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30' : 'text-zinc-500'}">
				{taskBadge}
			</span>
		</div>
	</div>

	<!-- Search & Filter Toolbar (only shown when there is active output or in Raw Logs) -->
	{#if (activeTab === 'thoughts' && hasActiveOutput) || activeTab === 'logs'}
		<div class="px-3 py-2 bg-zinc-950/80 border-b border-zinc-800/80 flex items-center justify-between gap-3 text-xs flex-wrap">
			<!-- Search Box -->
			<div class="relative flex-1 min-w-[200px]">
				<Search class="w-3.5 h-3.5 absolute left-2.5 top-2 text-zinc-500" />
				<input 
					type="text" 
					bind:value={searchQuery}
					placeholder="ค้นหาในผลลัพธ์, คำสั่ง หรือข้อผิดพลาด..."
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
					Commands
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

	<!-- Content Area -->
	<div class="p-4 flex-1 overflow-y-auto text-xs font-mono">
		<!-- THOUGHTS & REASONING TAB -->
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
			{:else if terminalLogs}
				<pre class="text-zinc-300 whitespace-pre-wrap">{terminalLogs}</pre>
			{:else}
				<!-- Redesigned Interactive Empty State (Consensus UX) -->
				<div class="max-w-3xl mx-auto py-4 flex flex-col gap-5 font-sans">
					<div class="text-center flex flex-col items-center gap-1.5">
						<div class="w-10 h-10 rounded-full bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center mb-1">
							<Sparkles class="w-5 h-5 text-indigo-400" />
						</div>
						<h2 class="text-base font-bold text-zinc-100">วันนี้อยากให้ช่วยอะไร?</h2>
						<p class="text-xs text-zinc-400 max-w-lg">
							คุณกำลังอยู่ในโหมด <strong class="text-cyan-300">{wsDetails?.name ? `โปรเจกต์ ${wsDetails.name}` : 'Auto Temp (ไม่เลือกโปรเจกต์)'}</strong> — พิมพ์คำสั่งด้านบน หรือคลิกเลือกการ์ดตัวอย่างด้านล่างเพื่อเริ่มงานได้ทันที
						</p>
					</div>

					<!-- Quick Starter Cards -->
					<div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
						{#each quickStarters as starter}
							<button
								onclick={() => onApplyStarter && onApplyStarter(starter.prompt, starter.provider)}
								class="text-left p-3.5 rounded-xl border transition flex flex-col justify-between gap-2 cursor-pointer group {starter.color}"
							>
								<div class="flex flex-col gap-1">
									<div class="flex items-center justify-between gap-2">
										<span class="font-bold text-xs text-zinc-100 group-hover:underline">{starter.title}</span>
										<span class="text-[10px] px-2 py-0.5 rounded-full bg-zinc-950/60 border border-zinc-700/60 font-mono shrink-0">
											{starter.badge}
										</span>
									</div>
									<p class="text-[11px] text-zinc-300/80 leading-relaxed">
										{starter.desc}
									</p>
								</div>
								<div class="flex items-center gap-1 text-[11px] font-medium opacity-80 group-hover:opacity-100">
									<span>คลิกเพื่อใช้เทมเพลตนี้</span>
									<ArrowRight class="w-3 h-3 transition group-hover:translate-x-0.5" />
								</div>
							</button>
						{/each}
					</div>

					<!-- Recent Tasks Quick-Jump -->
					{#if recentHistory.length > 0 && onSelectHistoryTask}
						<div class="flex flex-col gap-2 pt-2 border-t border-zinc-800/80">
							<div class="flex items-center justify-between text-xs text-zinc-400">
								<div class="flex items-center gap-1.5 font-medium text-zinc-300">
									<Clock class="size-3.5 text-zinc-400" strokeWidth={1.5} />
									<span>Recent runs</span>
								</div>
								<span class="text-[11px] text-zinc-500">Click to view previous results</span>
							</div>
							<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
								{#each recentHistory.slice(0, 4) as item}
									<button
										onclick={() => onSelectHistoryTask(item)}
										class="text-left p-2.5 rounded-lg bg-zinc-950/60 hover:bg-zinc-800/60 border border-zinc-850 transition-colors flex flex-col gap-1 cursor-pointer"
									>
										<div class="flex items-center justify-between text-[10px] font-mono text-zinc-400">
											<span class="text-zinc-200 font-medium">
												{item.mode === 'consensus' ? 'Consensus' : item.mode === 'both' ? 'Dual' : item.provider?.includes('DeepSeek') ? 'DeepSeek R1' : 'Codex'}
											</span>
											<span class="text-zinc-400">{fmtTokens(getNetTokens(item.tokens))} net tok</span>
										</div>
										<div class="text-xs text-zinc-200 truncate font-sans">
											{item.prompt || '(No prompt)'}
										</div>
									</button>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/if}

		<!-- DIFF TAB -->
		{:else if activeTab === 'diff' || activeTab === 'deepseek_diff'}
			{#if getCurrentDiff()}
				<pre class="text-zinc-300 whitespace-pre-wrap leading-relaxed">{getCurrentDiff()}</pre>
			{:else}
				<div class="text-zinc-500 italic py-8 text-center font-sans">ไม่มีการแก้ไขไฟล์ใน Git สำหรับงานนี้</div>
			{/if}

		<!-- TEST EVIDENCE TAB -->
		{:else if activeTab === 'tests'}
			{#if getTestEvidence()}
				{@const evidence = getTestEvidence()}
				<div class="flex flex-col gap-3 font-sans">
					<div class="flex items-center gap-2 p-3 rounded-lg border {evidence?.passed ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-300' : 'bg-rose-950/30 border-rose-800/60 text-rose-300'}">
						{#if evidence?.passed}
							<ShieldCheck class="w-5 h-5 text-emerald-400 shrink-0" />
							<div>
								<div class="font-bold text-sm">
									{evidence?.type === 'syntax_check' ? 'Automated Syntax Verification: PASSED' : 'Automated Test Suite: PASSED'}
								</div>
								<div class="text-xs text-zinc-400">
									{evidence?.type === 'syntax_check' ? 'All modified code files passed syntax/compilation validation.' : 'All tests completed successfully without errors.'}
								</div>
							</div>
						{:else}
							<ShieldAlert class="w-5 h-5 text-rose-400 shrink-0" />
							<div>
								<div class="font-bold text-sm">
									{evidence?.type === 'syntax_check' ? 'Automated Syntax Verification: FAILED' : 'Automated Test Suite: FAILED'}
								</div>
								<div class="text-xs text-zinc-400">
									{evidence?.type === 'syntax_check' ? 'Syntax errors detected in modified code files.' : 'Errors detected during test suite execution.'}
								</div>
							</div>
						{/if}
					</div>

					<div class="space-y-1 font-mono text-xs">
						<div class="text-zinc-400 text-[11px] font-semibold">Test Command Executed:</div>
						<div class="p-2 bg-zinc-900 rounded border border-zinc-800 text-cyan-300">{evidence?.testCmd}</div>
					</div>

					<div class="space-y-1 font-mono text-xs">
						<div class="text-zinc-400 text-[11px] font-semibold">Verification Output:</div>
						<pre class="p-3 bg-zinc-950 rounded border border-zinc-800 text-zinc-300 whitespace-pre-wrap max-h-96 overflow-y-auto">{evidence?.output || '(No test output)'}</pre>
					</div>
				</div>
			{:else}
				<div class="text-zinc-500 italic py-8 text-center font-sans">ไม่มีผลรัน Test Gate สำหรับงานนี้</div>
			{/if}

		<!-- RAW LOGS TAB -->
		{:else if activeTab === 'logs'}
			<div class="flex flex-col gap-0.5">
				{#each getFilteredLogLines(getActiveRawLogs()) as item}
					<div class="py-0.5 px-1.5 rounded transition {item.line.includes('exec') ? 'text-cyan-300' : item.line.includes('error') ? 'text-rose-400' : 'text-zinc-300'}">
						{item.line}
					</div>
				{:else}
					<div class="text-zinc-500 italic py-4 text-center font-sans">ยังไม่มี Raw Logs สำหรับงานนี้</div>
				{/each}
			</div>

		<!-- FILES & COMMITS TAB -->
		{:else if activeTab === 'files'}
			{#if wsDetails}
				<div class="flex flex-col gap-3.5 text-zinc-300 font-sans">
					<div>
						<div class="text-zinc-500 text-[10px] uppercase tracking-wider mb-1 font-semibold font-mono">Commits ล่าสุดใน {wsDetails.name}</div>
						<div class="space-y-1 p-2.5 bg-zinc-900/40 rounded border border-zinc-800/80 font-mono text-xs">
							{#each wsDetails.recentCommits as commit}
								<div class="text-zinc-300 truncate">{commit}</div>
							{:else}
								<div class="text-zinc-600 italic">No recent commits.</div>
							{/each}
						</div>
					</div>
					<div>
						<div class="text-zinc-500 text-[10px] uppercase tracking-wider mb-1 font-semibold font-mono">Tracked Files ({wsDetails.files.length})</div>
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
			{:else}
				<div class="text-zinc-500 italic py-8 text-center font-sans">
					เลือกโปรเจกต์หลักทางซ้าย (เช่น Android-Tv หรือ proxmox-codex-bridge) เพื่อดูไฟล์และประวัติ Git Commit
				</div>
			{/if}
		{/if}
	</div>
</div>
