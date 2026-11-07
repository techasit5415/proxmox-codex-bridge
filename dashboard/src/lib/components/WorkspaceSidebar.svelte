<script lang="ts">
	import { Plus, GitBranch, Trash2, ChevronDown, ChevronRight, FolderGit2, Folder, FolderOpen, X, Check } from 'lucide-svelte';
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

	let isWorkspaceActive = $derived(Boolean(activeWs && activeWs !== 'all' && activeWs !== 'auto-temp'));
	let isTempSelected = $derived(Boolean(activeWs && activeWs.startsWith('temp-')));

	function formatTempName(ws: string): string {
		return ws.replace(/^temp-/, '').replace(/-[a-z0-9]{4}$/i, '');
	}

	function handleToggleWorkspace(ws: string) {
		// Untick if already active, otherwise select
		if (activeWs === ws) {
			onSelectWorkspace('all');
		} else {
			onSelectWorkspace(ws);
		}
	}
</script>

<div class="flex flex-col gap-3">
	<div class="rounded-xl border border-zinc-800/90 bg-zinc-900/40 p-3 flex flex-col gap-2">
		<!-- Section Header -->
		<div class="flex items-center justify-between text-xs px-0.5">
			<div class="flex items-center gap-1.5">
				<FolderGit2 class="size-3.5 text-zinc-400" strokeWidth={1.5} />
				<span class="font-medium text-zinc-200">Workspaces</span>
				<span class="text-[10px] font-mono text-zinc-400">({projectWorkspaces.length})</span>
			</div>
			
			<div class="flex items-center gap-1.5">
				{#if isWorkspaceActive}
					<button
						onclick={() => onSelectWorkspace('all')}
						class="text-[11px] px-1.5 py-0.5 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer flex items-center gap-1"
						title="Untick current workspace"
					>
						<X class="size-3" strokeWidth={1.5} />
						<span>Untick</span>
					</button>
				{/if}
				<button 
					onclick={onOpenClone}
					class="text-[11px] px-2 py-0.5 rounded-md bg-zinc-800/80 hover:bg-zinc-800 text-zinc-300 border border-zinc-700/60 transition-colors flex items-center gap-1 cursor-pointer font-medium"
					title="Clone repository from GitHub"
				>
					<Plus class="size-3" strokeWidth={1.5} />
					<span>Clone</span>
				</button>
			</div>
		</div>

		<!-- Workspaces List -->
		<div class="flex flex-col gap-0.5 pt-1">
			{#each projectWorkspaces as ws}
				{@const isActive = ws === activeWs}
				<div class="group relative flex items-center">
					<button 
						onclick={() => handleToggleWorkspace(ws)}
						class="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-mono transition-colors flex items-center justify-between cursor-pointer {isActive ? 'bg-zinc-800 text-zinc-100 border border-zinc-700 font-medium' : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200'} pr-8"
						title={isActive ? 'Click to untick' : `Click to select ${ws}`}
					>
						<span class="truncate flex items-center gap-2">
							<Folder class="size-3.5 text-zinc-400 shrink-0" strokeWidth={1.5} />
							<span class="truncate">{ws}</span>
						</span>
						
						{#if isActive}
							<span class="flex items-center gap-1 text-[10px] text-zinc-400 font-sans shrink-0">
								<Check class="size-3 text-emerald-400" strokeWidth={2} />
							</span>
						{/if}
					</button>

					<!-- Action Buttons on Row (Untick & Delete) -->
					<div class="absolute right-1.5 flex items-center gap-0.5">
						{#if isActive}
							<button
								onclick={(e) => { e.stopPropagation(); onSelectWorkspace('all'); }}
								title="Untick workspace"
								class="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer"
							>
								<X class="size-3" strokeWidth={1.5} />
							</button>
						{/if}

						{#if onDeleteWorkspace && ws === 'demo-project'}
							<button
								onclick={(e) => { e.stopPropagation(); onDeleteWorkspace(ws); }}
								title="Delete workspace"
								class="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-rose-950/60 text-zinc-500 hover:text-rose-400 transition-colors cursor-pointer"
							>
								<Trash2 class="size-3" strokeWidth={1.5} />
							</button>
						{/if}
					</div>
				</div>
			{:else}
				<div class="text-[11px] text-zinc-500 py-3 text-center">No workspaces found</div>
			{/each}
		</div>

		<!-- Collapsible Temp Workspaces -->
		{#if tempCount > 0}
			<div class="border-t border-zinc-800/80 pt-2 flex flex-col gap-1">
				<div class="flex items-center justify-between text-xs px-0.5">
					<button
						onclick={() => (showTempFolders = !showTempFolders)}
						class="flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer font-medium"
					>
						{#if showTempFolders || isTempSelected}
							<ChevronDown class="size-3 text-zinc-400" strokeWidth={1.5} />
						{:else}
							<ChevronRight class="size-3 text-zinc-500" strokeWidth={1.5} />
						{/if}
						<span>Temporary runs</span>
						<span class="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 font-mono">
							{tempCount}
						</span>
					</button>

					{#if onCleanTempWorkspaces}
						<button 
							onclick={onCleanTempWorkspaces}
							title="Clean all temporary workspaces"
							class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800/60 hover:bg-rose-950/40 text-zinc-400 hover:text-rose-300 border border-zinc-700/40 cursor-pointer flex items-center gap-1 transition-colors"
						>
							<Trash2 class="size-2.5" strokeWidth={1.5} />
							<span>Clear</span>
						</button>
					{/if}
				</div>

				{#if showTempFolders || isTempSelected}
					<div class="flex flex-col gap-0.5 max-h-36 overflow-y-auto pr-1 pl-1 border-l border-zinc-800">
						{#each tempWorkspaces as ws}
							{@const isTempActive = ws === activeWs}
							<div class="group relative flex items-center">
								<button 
									onclick={() => handleToggleWorkspace(ws)}
									title={isTempActive ? 'Click to untick' : ws}
									class="w-full text-left px-2 py-1 rounded-md text-[11px] font-mono transition-colors flex items-center justify-between cursor-pointer pr-6 {isTempActive ? 'bg-zinc-800 text-zinc-100 border border-zinc-700' : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-300'}"
								>
									<span class="truncate flex items-center gap-1.5">
										<FolderOpen class="size-2.5 text-zinc-500 shrink-0" strokeWidth={1.5} />
										<span class="truncate">{formatTempName(ws)}</span>
									</span>
									{#if isTempActive}
										<Check class="size-2.5 text-emerald-400 shrink-0" strokeWidth={2} />
									{/if}
								</button>

								<div class="absolute right-1 flex items-center gap-0.5">
									{#if isTempActive}
										<button
											onclick={(e) => { e.stopPropagation(); onSelectWorkspace('all'); }}
											title="Untick"
											class="p-0.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 cursor-pointer"
										>
											<X class="size-2.5" strokeWidth={1.5} />
										</button>
									{/if}
									{#if onDeleteWorkspace}
										<button
											onclick={(e) => { e.stopPropagation(); onDeleteWorkspace(ws); }}
											title="Delete temp workspace"
											class="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-rose-950/60 text-zinc-500 hover:text-rose-400 transition-colors cursor-pointer"
										>
											<Trash2 class="size-2.5" strokeWidth={1.5} />
										</button>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<!-- Active Project Git Status Footer -->
		{#if wsDetails && isWorkspaceActive}
			<div class="mt-1 pt-2 border-t border-zinc-800 flex items-center justify-between text-[11px] font-mono text-zinc-400">
				<div class="flex items-center gap-1.5 truncate">
					<GitBranch class="size-3 text-zinc-400 shrink-0" strokeWidth={1.5} />
					<span class="text-zinc-200 font-medium truncate">{wsDetails.branch}</span>
					<span class="text-zinc-600">·</span>
					<span class="text-zinc-400">{wsDetails.files.length} files</span>
				</div>
				<span class="text-[10px] px-1.5 py-0.2 rounded border border-zinc-700 bg-zinc-800/80 text-zinc-300">
					{wsDetails.statusSummary}
				</span>
			</div>
		{/if}
	</div>
</div>
