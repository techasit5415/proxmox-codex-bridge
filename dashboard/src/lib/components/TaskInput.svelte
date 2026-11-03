<script lang="ts">
	import { Play, RefreshCw, Layers, Clock, Plus, Code, Sparkles, GitBranch, FolderGit2 } from 'lucide-svelte';
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
	let isAutoTemp = $derived(!activeWs || activeWs === 'all' || activeWs === 'auto-temp');

	function getModeHint(mode: string): string {
		if (mode === 'consensus') return '🏆 Consensus 3 ขั้นตอน: Codex + DeepSeek ต่างคนต่างคิด → สลับกันตรวจ (Peer Review) → สรุปทางออกที่ดีที่สุด';
		if (mode === 'both') return '⚡ Dual Compare: รัน Codex และ DeepSeek พร้อมกันใน Git Worktree แยกกันเพื่อเปรียบเทียบผลลัพธ์';
		if (mode === 'deepseek') return '🧠 DeepSeek R1 (KMITL GPU): คิดวิเคราะห์เชิงลึก + ค้นเว็บสด [TOOL:WEB_SEARCH] + อ่านลิงก์ GitHub อัตโนมัติ';
		return '🤖 OpenAI Codex (ChatGPT Plus): เขียนโค้ด แก้ไขไฟล์ รันคำสั่ง Terminal และตรวจสอบ Git Diff ในโปรเจกต์';
	}

	function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			onExecute();
		}
	}
</script>

<div class="rounded-xl border border-zinc-800/90 bg-zinc-900/40 p-4 flex flex-col gap-3 shadow-sm">
	{#if selectedTaskId}
		<div class="flex items-center justify-between px-3 py-2 rounded-lg bg-amber-950/30 border border-amber-700/40 text-xs">
			<div class="flex items-center gap-2 text-amber-200">
				<Clock class="w-3.5 h-3.5 text-amber-400 shrink-0" />
				<span>กำลังดูผลลัพธ์ย้อนหลังจาก History — คุณสามารถแก้ไขคำสั่งด้านล่างเพื่อรันซ้ำ หรือกดเริ่มงานใหม่</span>
			</div>
			<button 
				onclick={onClearSelected}
				class="px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 text-[11px] transition font-semibold flex items-center gap-1 cursor-pointer shrink-0"
			>
				<Plus class="w-3 h-3" />
				<span>เริ่มงานใหม่</span>
			</button>
		</div>
	{/if}

	<!-- Top Row: Prompt Label + Target Workspace Pill + Mode Selector -->
	<div class="flex items-center justify-between text-xs flex-wrap gap-2">
		<div class="flex items-center gap-2 flex-wrap">
			<span class="font-semibold text-zinc-200 text-sm">สั่งงาน AI (Prompt)</span>

			<!-- Target Workspace Indicator & Quick Switcher -->
			<div class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] border {isAutoTemp ? 'bg-cyan-950/50 border-cyan-800/60 text-cyan-200' : 'bg-emerald-950/60 border-emerald-700/60 text-emerald-200'}">
				{#if isAutoTemp}
					<Sparkles class="w-3 h-3 text-cyan-400 shrink-0" />
					<span>พื้นที่รัน: <strong>Auto Temp (สร้างโฟลเดอร์ใหม่อัตโนมัติ)</strong></span>
				{:else}
					<FolderGit2 class="w-3 h-3 text-emerald-400 shrink-0" />
					<span>พื้นที่รัน: <strong class="font-mono">{activeWs}</strong></span>
					{#if onSelectWorkspace}
						<button
							onclick={() => onSelectWorkspace('all')}
							title="สลับกลับเป็นโหมด Auto Temp (ไม่ผูกโปรเจกต์)"
							class="ml-1 px-1.5 py-0.2 rounded bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 text-[10px] cursor-pointer transition"
						>
							✕ สลับเป็น Auto Temp
						</button>
					{/if}
				{/if}

				{#if onSelectWorkspace && projectWorkspaces.length > 0}
					<select
						value={isAutoTemp ? 'all' : activeWs}
						onchange={(e) => onSelectWorkspace((e.currentTarget as HTMLSelectElement).value)}
						class="ml-1 bg-zinc-900/90 text-zinc-300 border border-zinc-700/80 rounded px-1.5 py-0.5 text-[10px] font-mono focus:outline-none cursor-pointer"
						title="เลือกโปรเจกต์ที่จะรันคำสั่งนี้"
					>
						<option value="all">✨ Auto Temp (ชั่วคราว)</option>
						{#each projectWorkspaces as ws}
							<option value={ws}>📁 {ws}</option>
						{/each}
					</select>
				{/if}
			</div>

			{#if prompt.trim()}
				{@const taskType = detectTaskType(prompt)}
				<span class="text-[10px] px-2 py-0.5 rounded-full font-mono flex items-center gap-1 transition {taskType === 'code' ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-800/60' : 'bg-amber-950/80 text-amber-300 border border-amber-800/60'}">
					{#if taskType === 'code'}
						<Code class="w-2.5 h-2.5" />
						<span>Code Task</span>
					{:else}
						<Sparkles class="w-2.5 h-2.5" />
						<span>Analysis / General</span>
					{/if}
				</span>
			{/if}
		</div>

		<!-- Segmented Control: Choose Provider -->
		<div class="flex rounded-lg bg-zinc-950 p-1 border border-zinc-800 text-[11px] font-medium flex-wrap gap-1">
			{#if activeModels.length > 0}
				{#each activeModels as m}
					<button 
						onclick={() => (provider = m.id)}
						class="px-2.5 py-1 rounded-md transition cursor-pointer {provider === m.id ? 'bg-zinc-800 text-zinc-100 font-semibold border border-zinc-700 shadow-xs' : 'text-zinc-400 hover:text-zinc-200'}"
					>
						{m.badge || m.name}
					</button>
				{/each}
			{:else}
				<button 
					onclick={() => (provider = 'codex')}
					class="px-2.5 py-1 rounded-md transition cursor-pointer {provider === 'codex' ? 'bg-zinc-800 text-emerald-300 font-semibold border border-zinc-700' : 'text-zinc-400 hover:text-zinc-200'}"
				>
					🤖 Codex (ChatGPT)
				</button>
				<button 
					onclick={() => (provider = 'deepseek')}
					class="px-2.5 py-1 rounded-md transition cursor-pointer {provider === 'deepseek' ? 'bg-violet-950/90 text-violet-200 font-semibold border border-violet-700/80' : 'text-zinc-400 hover:text-zinc-200'}"
				>
					🧠 DeepSeek R1
				</button>
			{/if}

			<button 
				onclick={() => (provider = 'both')}
				class="px-2.5 py-1 rounded-md transition flex items-center gap-1 cursor-pointer {provider === 'both' ? 'bg-indigo-600 text-white font-semibold shadow-xs' : 'text-zinc-400 hover:text-zinc-200'}"
			>
				<Layers class="w-3 h-3" />
				<span>Compare ทั้งคู่</span>
			</button>
			<button 
				onclick={() => (provider = 'consensus')}
				class="px-2.5 py-1 rounded-md transition flex items-center gap-1 cursor-pointer {provider === 'consensus' ? 'bg-gradient-to-r from-amber-500 to-indigo-600 text-white font-semibold shadow-xs' : 'text-zinc-400 hover:text-zinc-200'}"
			>
				<Sparkles class="w-3 h-3" />
				<span>Consensus (ช่วยกันคิด)</span>
			</button>
		</div>
	</div>

	<!-- Mode Subtitle / Helper -->
	<div class="text-[11px] text-zinc-400 bg-zinc-950/60 border border-zinc-800/60 rounded-lg px-3 py-1.5 flex items-center justify-between gap-2">
		<span>{getModeHint(provider)}</span>
		<span class="text-[10px] text-zinc-500 font-mono shrink-0 hidden sm:inline">Ctrl+Enter เพื่อรันทันที</span>
	</div>

	<textarea 
		bind:value={prompt}
		onkeydown={handleKeydown}
		rows="3"
		placeholder="พิมพ์คำสั่ง คำถาม หรือวางลิงก์ GitHub / เว็บไซต์ที่ต้องการให้ AI วิเคราะห์... (กด Ctrl+Enter เพื่อรัน)"
		class="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-indigo-500/60 resize-y font-sans placeholder:text-zinc-500 leading-relaxed"
	></textarea>

	<div class="flex items-center justify-between gap-3 pt-0.5 flex-wrap">
		<div class="flex items-center gap-2">
			<button
				type="button"
				onclick={() => (showBranchInput = !showBranchInput)}
				class="text-[11px] px-2.5 py-1 rounded-md bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 transition flex items-center gap-1.5 cursor-pointer font-mono"
			>
				<GitBranch class="w-3 h-3 text-zinc-500" />
				<span>{branch ? `Branch: ${branch}` : 'Branch: auto'}</span>
			</button>

			{#if showBranchInput}
				<input 
					type="text" 
					bind:value={branch}
					placeholder={provider === 'both' ? 'agent/codex-* & agent/deepseek-*' : 'ระบุชื่อ Git Branch (เว้นว่าง = auto)'}
					class="px-2.5 py-1 bg-zinc-950 border border-zinc-700 rounded-md text-xs font-mono text-zinc-200 focus:outline-none focus:border-indigo-500 placeholder:text-zinc-600 w-56"
				/>
			{/if}
		</div>

		<button 
			onclick={onExecute}
			disabled={isExecuting || !prompt.trim()}
			class="px-5 py-2 rounded-lg bg-gradient-to-r from-indigo-500 to-cyan-500 hover:from-indigo-400 hover:to-cyan-400 disabled:from-zinc-800 disabled:to-zinc-800 disabled:text-zinc-600 text-zinc-950 font-bold text-xs transition flex items-center gap-2 cursor-pointer shrink-0 shadow-sm"
		>
			{#if isExecuting}
				<RefreshCw class="w-3.5 h-3.5 animate-spin" />
				<span>
					{provider === 'consensus' ? 'กำลังรัน Consensus 3 ขั้นตอน...' : provider === 'both' ? 'กำลังรันเทียบ 2 โมเดล...' : 'กำลังประมวลผล...'}
				</span>
			{:else}
				<Play class="w-3.5 h-3.5 fill-current" />
				<span>
					{provider === 'consensus' ? 'รัน Consensus (ช่วยกันคิด)' : provider === 'both' ? 'รันเปรียบเทียบ 2 โมเดล' : 'รันคำสั่ง (Execute)'}
				</span>
			{/if}
		</button>
	</div>
</div>
