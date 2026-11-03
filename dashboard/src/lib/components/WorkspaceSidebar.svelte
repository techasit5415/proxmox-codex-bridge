<script lang="ts">
	import { Plus, GitBranch, Trash2, ChevronDown, ChevronRight, FolderGit2, Sparkles, Globe } from 'lucide-svelte';
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

	// Auto-expand temp list only if the user actively selected a temp-* workspace
	let isTempSelected = $derived(Boolean(activeWs && activeWs.startsWith('temp-')));

	function formatTempName(ws: string): string {
		return ws.replace(/^temp-/, '').replace(/-[a-z0-9]{4}$/i, '');
	}
</script>

<div class="flex flex-col gap-3">
	<!-- Workspaces Card -->
	<div class="rounded-xl border border-zinc-800/90 bg-zinc-900/40 p-3 flex flex-col gap-2.5 shadow-sm">
		<div class="flex items-center justify-between text-xs">
			<div class="flex items-center gap-1.5">
				<FolderGit2 class="w-3.5 h-3.5 text-indigo-400" />
				<span class="font-semibold text-zinc-200">พื้นที่ทำงาน (Workspace)</span>
			</div>
			<button 
				onclick={onOpenClone}
				class="text-[11px] px-2 py-0.5 rounded-md bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 transition flex items-center gap-1 cursor-pointer font-medium"
				title="Clone โปรเจกต์จาก GitHub ลง Proxmox"
			>
				<Plus class="w-3 h-3" />
				<span>Clone Repo</span>
			</button>
		</div>

		<!-- Default Mode: Unselected / Auto-Temp -->
		<button 
			onclick={() => onSelectWorkspace('all')}
			class="w-full text-left px-2.5 py-2 rounded-lg text-xs transition flex items-center justify-between cursor-pointer {activeWs === 'all' || activeWs === 'auto-temp' || !activeWs ? 'bg-gradient-to-r from-cyan-950/70 to-indigo-950/60 text-cyan-200 border border-cyan-700/60 shadow-xs' : 'bg-zinc-950/40 text-zinc-400 border border-zinc-800/60 hover:bg-zinc-800/50 hover:text-zinc-200'}"
		>
			<div class="flex flex-col gap-0.5 min-w-0 pr-2">
				<div class="flex items-center gap-1.5 font-semibold">
					<Globe class="w-3.5 h-3.5 text-cyan-400 shrink-0" />
					<span class="truncate">ไม่เลือกโปรเจกต์ (ค่าเริ่มต้น)</span>
				</div>
				<span class="text-[10px] text-zinc-400 font-normal pl-5 truncate">
					ดูประวัติทั้งหมด • รันงานใหม่ใน Auto Temp
				</span>
			</div>
			{#if activeWs === 'all' || activeWs === 'auto-temp' || !activeWs}
				<span class="w-2 h-2 rounded-full bg-cyan-400 shrink-0 shadow-[0_0_8px_rgba(34,211,238,0.8)]"></span>
			{/if}
		</button>

		<!-- Real Project Workspaces -->
		<div class="flex flex-col gap-1 pt-0.5">
			<div class="flex items-center justify-between text-[10px] text-zinc-500 px-1 font-medium uppercase tracking-wider">
				<span>โปรเจกต์หลัก ({projectWorkspaces.length})</span>
				{#if activeWs && activeWs !== 'all' && activeWs !== 'auto-temp'}
					<button
						onclick={() => onSelectWorkspace('all')}
						class="text-cyan-400 hover:underline cursor-pointer normal-case font-normal"
					>
						ยกเลิกการเลือก
					</button>
				{/if}
			</div>

			{#each projectWorkspaces as ws}
				<div class="group relative flex items-center">
					<button 
						onclick={() => onSelectWorkspace(ws)}
						class="w-full text-left px-2.5 py-1.5 rounded-md text-xs font-mono transition flex items-center justify-between cursor-pointer {ws === activeWs ? 'bg-emerald-950/50 text-emerald-200 border border-emerald-700/60 font-semibold' : 'text-zinc-300 hover:bg-zinc-800/50 hover:text-zinc-100'} {ws === 'demo-project' ? 'pr-7' : ''}"
					>
						<span class="truncate flex items-center gap-1.5">
							<span class="text-zinc-500">📁</span>
							<span class="truncate">{ws}</span>
						</span>
						{#if ws === activeWs}
							<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
						{/if}
					</button>

					{#if onDeleteWorkspace && ws === 'demo-project'}
						<button
							onclick={(e) => { e.stopPropagation(); onDeleteWorkspace(ws); }}
							title="ลบ Workspace นี้"
							class="absolute right-1.5 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-950/60 text-zinc-500 hover:text-red-400 transition cursor-pointer"
						>
							<Trash2 class="w-3 h-3" />
						</button>
					{/if}
				</div>
			{:else}
				<div class="text-[11px] text-zinc-600 italic py-1.5 text-center">ยังไม่มีโปรเจกต์หลัก กด Clone Repo เพื่อเพิ่ม</div>
			{/each}
		</div>

		<!-- Collapsible Temp Workspaces Section (Never pushes History off screen!) -->
		{#if tempCount > 0}
			<div class="border-t border-zinc-800/70 pt-2 flex flex-col gap-1.5">
				<div class="flex items-center justify-between">
					<button
						onclick={() => (showTempFolders = !showTempFolders)}
						class="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 transition cursor-pointer font-medium"
					>
						{#if showTempFolders || isTempSelected}
							<ChevronDown class="w-3.5 h-3.5 text-amber-400" />
						{:else}
							<ChevronRight class="w-3.5 h-3.5 text-zinc-500" />
						{/if}
						<span>โฟลเดอร์ชั่วคราว Temp</span>
						<span class="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 font-mono">
							{tempCount}
						</span>
					</button>

					{#if onCleanTempWorkspaces}
						<button 
							onclick={onCleanTempWorkspaces}
							title="ลบ Temp Workspaces ทั้งหมด"
							class="text-[10px] px-1.5 py-0.5 rounded bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-800/40 cursor-pointer flex items-center gap-1 transition"
						>
							<Trash2 class="w-2.5 h-2.5" />
							<span>ล้างทั้งหมด</span>
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
									class="w-full text-left px-2 py-1 rounded text-[11px] transition flex items-center justify-between cursor-pointer pr-6 {ws === activeWs ? 'bg-amber-950/50 text-amber-200 border border-amber-700/50 font-medium' : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-300'}"
								>
									<span class="truncate flex items-center gap-1.5">
										<Sparkles class="w-2.5 h-2.5 text-amber-400/80 shrink-0" />
										<span class="truncate">{formatTempName(ws)}</span>
									</span>
									{#if ws === activeWs}
										<span class="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"></span>
									{/if}
								</button>

								{#if onDeleteWorkspace}
									<button
										onclick={(e) => { e.stopPropagation(); onDeleteWorkspace(ws); }}
										title="ลบ Temp Workspace นี้"
										class="absolute right-1 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-950/60 text-zinc-500 hover:text-red-400 transition cursor-pointer"
									>
										<Trash2 class="w-2.5 h-2.5" />
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
					<GitBranch class="w-3 h-3 text-emerald-400 shrink-0" />
					<span class="text-zinc-200 font-semibold truncate">{wsDetails.branch}</span>
					<span class="text-zinc-600">•</span>
					<span class="text-zinc-400">{wsDetails.files.length} ไฟล์</span>
				</div>
				<span class="text-[10px] px-1.5 py-0.2 rounded {wsDetails.clean ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-300 border border-amber-500/20'}">
					{wsDetails.statusSummary}
				</span>
			</div>
		{/if}
	</div>
</div>
