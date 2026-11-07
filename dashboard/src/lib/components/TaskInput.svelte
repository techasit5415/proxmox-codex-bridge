<script lang="ts">
	import { Play, RefreshCw, Layers, Clock, Plus, Code, GitBranch, FolderGit2, GitMerge, Terminal } from 'lucide-svelte';
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
		if (mode === 'consensus') return 'Consensus 3 ขั้นตอน: Codex และ DeepSeek ต่างคนต่างคิด → ตรวจสอบไขว้กัน (Peer Review) → สรุปผลลัพธ์ที่ดีที่สุด';
		if (mode === 'both') return 'Dual Compare: รัน Codex และ DeepSeek พร้อมกันใน Git Worktree แยกกันเพื่อเปรียบเทียบผลลัพธ์';
		if (mode === 'deepseek') return 'DeepSeek R1 (KMITL GPU): คิดวิเคราะห์เชิงลึก + ค้นเว็บสด + อ่านโค้ดจากลิงก์ GitHub อัตโนมัติ';
		return 'OpenAI Codex: แก้ไขโค้ด รันคำสั่ง Terminal และสร้าง Git Diff ในโปรเจกต์';
	}

	function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			onExecute();
		}
	}
</script>

<div class="rounded-xl border border-zinc-800/90 bg-zinc-900/50 p-4 flex flex-col gap-3">
	{#if selectedTaskId}
		<div class="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-xs">
			<div class="flex items-center gap-2 text-zinc-300">
				<Clock class="size-3.5 text-zinc-400 shrink-0" strokeWidth={1.5} />
				<span>กำลังดูผลลัพธ์จาก History — แก้ไขข้อความเพื่อรันใหม่ หรือกดเริ่มงานใหม่</span>
			</div>
			<button 
				onclick={onClearSelected}
				class="px-2.5 py-1 rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-200 border border-zinc-600 text-[11px] transition-colors font-medium flex items-center gap-1 cursor-pointer shrink-0"
			>
				<Plus class="size-3" strokeWidth={1.5} />
				<span>เริ่มงานใหม่</span>
			</button>
		</div>
	{/if}

	<!-- Top Row: Prompt Label + Target Workspace Pill + Mode Selector -->
	<div class="flex items-center justify-between text-xs flex-wrap gap-2">
		<div class="flex items-center gap-2 flex-wrap">
			<span class="font-medium text-zinc-200 text-sm">คำสั่งปฏิบัติการ (Prompt)</span>

			<!-- Target Workspace Indicator & Quick Switcher -->
			<div class="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] border border-zinc-700/80 bg-zinc-800/80 text-zinc-300">
				{#if isAutoTemp}
					<Terminal class="size-3 text-zinc-400 shrink-0" strokeWidth={1.5} />
					<span>Auto Temp (สร้างโฟลเดอร์ใหม่อัตโนมัติ)</span>
				{:else}
					<FolderGit2 class="size-3 text-zinc-400 shrink-0" strokeWidth={1.5} />
					<span>โปรเจกต์: <strong class="font-mono text-zinc-200">{activeWs}</strong></span>
					{#if onSelectWorkspace}
						<button
							onclick={() => onSelectWorkspace('all')}
							title="สลับกลับเป็นโหมด Auto Temp"
							class="ml-1 px-1.5 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-[10px] cursor-pointer transition-colors"
						>
							สลับเป็น Auto Temp
						</button>
					{/if}
				{/if}

				{#if onSelectWorkspace && projectWorkspaces.length > 0}
					<select
						value={isAutoTemp ? 'all' : activeWs}
						onchange={(e) => onSelectWorkspace((e.currentTarget as HTMLSelectElement).value)}
						class="ml-1 bg-zinc-900 text-zinc-300 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] font-mono focus:outline-none cursor-pointer"
						title="เลือกโปรเจกต์ที่จะรันคำสั่งนี้"
					>
						<option value="all">Auto Temp (ชั่วคราว)</option>
						{#each projectWorkspaces as ws}
							<option value={ws}>{ws}</option>
						{/each}
					</select>
				{/if}
			</div>

			{#if prompt.trim()}
				{@const taskType = detectTaskType(prompt)}
				<span class="text-[10px] px-2 py-0.5 rounded-md font-mono border border-zinc-700/80 bg-zinc-800/80 text-zinc-300">
					{taskType === 'code' ? 'Code' : 'Analysis'}
				</span>
			{/if}
		</div>

		<!-- Segmented Control: Choose Provider -->
		<div class="flex rounded-lg bg-zinc-950 p-1 border border-zinc-800 text-[11px] font-medium flex-wrap gap-1">
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
					Codex (ChatGPT)
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

	<!-- Mode Subtitle / Helper -->
	<div class="text-[11px] text-zinc-400 bg-zinc-950/60 border border-zinc-800/60 rounded-lg px-3 py-1.5 flex items-center justify-between gap-2">
		<span>{getModeHint(provider)}</span>
		<span class="text-[10px] text-zinc-500 font-mono shrink-0 hidden sm:inline">Ctrl+Enter เพื่อรัน</span>
	</div>

	<textarea 
		bind:value={prompt}
		onkeydown={handleKeydown}
		rows="3"
		placeholder="พิมพ์คำสั่ง คำถาม หรือระบุสิ่งที่ต้องการให้ระบบวิเคราะห์… (Ctrl+Enter เพื่อส่งคำสั่ง)"
		class="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-zinc-600 resize-y font-sans placeholder:text-zinc-500 leading-relaxed"
	></textarea>

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
					placeholder={provider === 'both' ? 'agent/codex-* & agent/deepseek-*' : 'ระบุชื่อ Git Branch'}
					class="px-2.5 py-1 bg-zinc-950 border border-zinc-700 rounded-md text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-500 placeholder:text-zinc-600 w-56"
				/>
			{/if}
		</div>

		<button 
			onclick={onExecute}
			disabled={isExecuting || !prompt.trim()}
			class="h-9 px-5 rounded-lg bg-zinc-100 hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 font-medium text-xs transition-colors flex items-center gap-2 cursor-pointer shrink-0"
		>
			{#if isExecuting}
				<RefreshCw class="size-3.5 animate-spin" strokeWidth={1.5} />
				<span>
					{provider === 'consensus' ? 'กำลังรัน Consensus…' : provider === 'both' ? 'กำลังรัน Dual Compare…' : 'กำลังประมวลผล…'}
				</span>
			{:else}
				<Play class="size-3.5 fill-current" strokeWidth={1.5} />
				<span>
					{provider === 'consensus' ? 'รัน Consensus' : provider === 'both' ? 'รัน Dual Compare' : 'ส่งคำสั่ง (Execute)'}
				</span>
			{/if}
		</button>
	</div>
</div>
