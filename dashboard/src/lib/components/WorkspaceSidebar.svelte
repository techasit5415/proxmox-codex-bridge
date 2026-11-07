<script lang="ts">
	import { Plus, GitBranch, Trash2, ChevronDown, ChevronRight, FolderGit2, Folder, FolderOpen, Globe } from 'lucide-svelte';
	import type { WorkspaceDetails } from '../types';

	interface Props {
		workspaces: string[];
		activeWs: string;
		wsDetails: WorkspaceDetails | null;
		onSelectWorkspace: (ws: string) => void;
		onOpenClone: () => void;
		onDeleteWorkspace?: (ws: string) => void;
		onCleanTempWorkspaces?: () => void;
	}

	let { 
		workspaces, 
		activeWs, 
		wsDetails, 
		onSelectWorkspace, 
		onOpenClone,
		onDeleteWorkspace,
		onCleanTempWorkspaces
	}: Props = $props();

	let showTempFolders = $state<boolean>(false);

	let projectWorkspaces = $derived(workspaces.filter(w => !w.startsWith('temp-')));
	let tempWorkspaces = $derived(workspaces.filter(w => w.startsWith('temp-')));
	let tempCount = $derived(tempWorkspaces.length);

	let isTempSelected = $derived(Boolean(activeWs && activeWs.startsWith('temp-')));

	function formatTempName(ws: string): string {
		return ws.replace(/^temp-/, '').replace(/-[a-z0-9]{4}$/i, '');
	}
</script>

<div class="flex flex-col gap-3">
	<!-- Workspaces Card -->
	<div class="rounded-xl border border-zinc-800/90 bg-zinc-900/50 p-3 flex flex-col gap-2.5">
		<div class="flex items-center justify-between text-xs">
			<div class="flex items-center gap-1.5">
				<FolderGit2 class="size-3.5 text-zinc-400" strokeWidth={1.5} />
				<span class="font-medium text-zinc-200">พื้นที่ทำงาน (Workspace)</span>
			</div>
			<button 
				onclick={onOpenClone}
				class="text-[11px] px-2 py-0.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700/80 transition-colors flex items-center gap-1 cursor-pointer font-medium"
				title="Clone โปรเจกต์จาก GitHub ลง Proxmox"
			>
				<Plus class="size-3" strokeWidth={1.5} />
				<span>Clone Repo</span>
			</button>
		</div>

		<!-- Default Mode: Unselected / Auto-Temp -->
		<button 
			onclick={() => onSelectWorkspace('all')}
			class="w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors flex items-center justify-between cursor-pointer {activeWs === 'all' || activeWs === 'auto-temp' || !activeWs ? 'bg-zinc-800/90 text-zinc-100 border border-zinc-700/80' : 'bg-zinc-950/40 text-zinc-400 border border-zinc-800/60 hover:bg-zinc-800/40 hover:text-zinc-200'}"
		>
			<div class="flex flex-col gap-0.5 min-w-0 pr-2">
				<div class="flex items-center gap-1.5 font-medium">
					<Globe class="size-3.5 text-zinc-400 shrink-0" strokeWidth={1.5} />
					<span class="truncate">ไม่เลือกโปรเจกต์ (ค่าเริ่มต้น)</span>
				</div>
				<span class="text-[10px] text-zinc-400 font-normal pl-5 truncate">
					ดูประวัติทั้งหมด · รันงานใหม่ใน Auto Temp
				</span>
			</div>
			{#if activeWs === 'all' || activeWs === 'auto-temp' || !activeWs}
				<span class="size-1.5 rounded-full bg-emerald-500 shrink-0"></span>
			{/if}
		</button>

		<!-- Real Project Workspaces -->
		<div class="flex flex-col gap-1 pt-0.5">
			<div class="flex items-center justify-between text-[11px] font-mono text-zinc-500 px-1">
				<span>โปรเจกต์หลัก ({projectWorkspaces.length})</span>
				{#if activeWs && activeWs !== 'all' && activeWs !== 'auto-temp'}
					<button
						onclick={() => onSelectWorkspace('all')}
						class="text-zinc-400 hover:text-zinc-200 cursor-pointer font-sans text-[10px] transition-colors"
					>
						ล้างการเลือก
					</button>
				{/if}
			</div>

			{#each projectWorkspaces as ws}
				<div class="group relative flex items-center">
					<button 
						onclick={() => onSelectWorkspace(ws)}
						class="w-full text-left px-2.5 py-1.5 rounded-md text-xs font-mono transition-colors flex items-center justify-between cursor-pointer {ws === activeWs ? 'bg-zinc-800 text-zinc-100 border border-zinc-700' : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200'} {ws === 'demo-project' ? 'pr-7' : ''}"
					>
						<span class="truncate flex items-center gap-1.5">
							<Folder class="size-3 text-zinc-500 shrink-0" strokeWidth={1.5} />
							<span class="truncate">{ws}</span>
						</span>
						{#if ws === activeWs}
							<span class="size-1.5 rounded-full bg-emerald-500 shrink-0"></span>
						{/if}
					</button>

					{#if onDeleteWorkspace && ws === 'demo-project'}
						<button
							onclick={(e) => { e.stopPropagation(); onDeleteWorkspace(ws); }}
							title="ลบ Workspace นี้"
							class="absolute right-1.5 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-rose-950/60 text-zinc-500 hover:text-rose-400 transition-colors cursor-pointer"
						>
							<Trash2 class="size-3" strokeWidth={1.5} />
						</button>
					{/if}
				</div>
			{:else}
				<div class="text-[11px] text-zinc-600 py-1.5 text-center">ยังไม่มีโปรเจกต์หลัก</div>
			{/each}
		</div>

		<!-- Collapsible Temp Workspaces Section -->
		{#if tempCount > 0}
			<div class="border-t border-zinc-800/80 pt-2 flex flex-col gap-1.5">
				<div class="flex items-center justify-between">
					<button
						onclick={() => (showTempFolders = !showTempFolders)}
						class="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer font-medium"
					>
						{#if showTempFolders || isTempSelected}
							<ChevronDown class="size-3.5 text-zinc-400" strokeWidth={1.5} />
						{:else}
							<ChevronRight class="size-3.5 text-zinc-500" strokeWidth={1.5} />
						{/if}
						<span>โฟลเดอร์ชั่วคราว</span>
						<span class="text-[10px] px-1.5 py-0.5 rounded-md bg-zinc-800 text-zinc-300 font-mono">
							{tempCount}
						</span>
					</button>

					{#if onCleanTempWorkspaces}
						<button 
							onclick={onCleanTempWorkspaces}
							title="ลบ Temp Workspaces ทั้งหมด"
							class="text-[10px] px-1.5 py-0.5 rounded-md bg-zinc-800 hover:bg-rose-950/40 text-zinc-400 hover:text-rose-300 border border-zinc-700/60 cursor-pointer flex items-center gap-1 transition-colors"
						>
							<Trash2 class="size-2.5" strokeWidth={1.5} />
							<span>ล้าง</span>
						</button>
					{/if}
				</div>

				{#if showTempFolders || isTempSelected}
					<div class="flex flex-col gap-0.5 max-h-36 overflow-y-auto pr-1 pl-1 border-l border-zinc-800/80">
						{#each tempWorkspaces as ws}
							<div class="group relative flex items-center">
								<button 
									onclick={() => onSelectWorkspace(ws)}
									title={ws}
									class="w-full text-left px-2 py-1 rounded-md text-[11px] font-mono transition-colors flex items-center justify-between cursor-pointer pr-6 {ws === activeWs ? 'bg-zinc-800 text-zinc-200 border border-zinc-700' : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-300'}"
								>
									<span class="truncate flex items-center gap-1.5">
										<FolderOpen class="size-2.5 text-zinc-500 shrink-0" strokeWidth={1.5} />
										<span class="truncate">{formatTempName(ws)}</span>
									</span>
									{#if ws === activeWs}
										<span class="size-1.5 rounded-full bg-zinc-400 shrink-0"></span>
									{/if}
								</button>

								{#if onDeleteWorkspace}
									<button
										onclick={(e) => { e.stopPropagation(); onDeleteWorkspace(ws); }}
										title="ลบ Temp Workspace นี้"
										class="absolute right-1 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-rose-950/60 text-zinc-500 hover:text-rose-400 transition-colors cursor-pointer"
									>
										<Trash2 class="size-2.5" strokeWidth={1.5} />
									</button>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<!-- Active Project Git Status Footer -->
		{#if wsDetails && activeWs !== 'all' && activeWs !== 'auto-temp'}
			<div class="mt-0.5 pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[11px] font-mono text-zinc-400">
				<div class="flex items-center gap-1.5 truncate">
					<GitBranch class="size-3 text-zinc-400 shrink-0" strokeWidth={1.5} />
					<span class="text-zinc-200 font-medium truncate">{wsDetails.branch}</span>
					<span class="text-zinc-600">·</span>
					<span class="text-zinc-400">{wsDetails.files.length} ไฟล์</span>
				</div>
				<span class="text-[10px] px-1.5 py-0.5 rounded-md border border-zinc-700/80 bg-zinc-800/80 text-zinc-300">
					{wsDetails.statusSummary}
				</span>
			</div>
		{/if}
	</div>
</div>
