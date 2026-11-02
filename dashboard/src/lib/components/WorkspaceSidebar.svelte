<script lang="ts">
	import { Plus, GitBranch, Trash2 } from 'lucide-svelte';
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

	let tempCount = $derived(workspaces.filter(w => w.startsWith('temp-')).length);
</script>

<div class="flex flex-col gap-4">
	<!-- Workspaces List -->
	<div class="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3.5 flex flex-col gap-2.5">
		<div class="flex items-center justify-between text-xs">
			<div class="flex items-center gap-2">
				<span class="font-medium text-zinc-400">Workspaces</span>
				{#if tempCount > 0 && onCleanTempWorkspaces}
					<button 
						onclick={onCleanTempWorkspaces}
						title="ลบ Temp Workspaces ทั้งหมด"
						class="text-[10px] px-1.5 py-0.5 rounded bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-800/40 cursor-pointer flex items-center gap-1 transition"
					>
						<Trash2 class="w-2.5 h-2.5" />
						<span>ล้าง Temp ({tempCount})</span>
					</button>
				{/if}
			</div>
			<button 
				onclick={onOpenClone}
				class="text-[11px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition flex items-center gap-1 cursor-pointer"
			>
				<Plus class="w-2.5 h-2.5" />
				<span>Clone</span>
			</button>
		</div>

		<div class="flex flex-col gap-1">
			<!-- Auto Temp Option -->
			<button 
				onclick={() => onSelectWorkspace('auto-temp')}
				class="w-full text-left px-2.5 py-1.5 rounded text-xs font-mono transition flex items-center justify-between cursor-pointer {activeWs === 'auto-temp' ? 'bg-amber-500/10 text-amber-300 border border-amber-500/30 font-semibold' : 'text-amber-400/80 hover:bg-zinc-800/40 hover:text-amber-300'}"
			>
				<span class="truncate flex items-center gap-1.5">
					<span class="text-amber-400">✨</span>
					<span>Auto Temp (สร้างตามคำถาม)</span>
				</span>
				{#if activeWs === 'auto-temp'}
					<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
				{/if}
			</button>

			<div class="my-0.5 border-t border-zinc-800/60"></div>

			{#each workspaces as ws}
				<div class="group relative flex items-center">
					<button 
						onclick={() => onSelectWorkspace(ws)}
						class="w-full text-left px-2.5 py-1.5 rounded text-xs font-mono transition flex items-center justify-between cursor-pointer {ws === activeWs ? 'bg-zinc-800 text-zinc-100 font-semibold' : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-300'} {ws.startsWith('temp-') || ws === 'demo-project' ? 'pr-7' : ''}"
					>
						<span class="truncate flex items-center gap-1.5">
							{#if ws.startsWith('temp-')}
								<span class="text-[9px] px-1 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-sans">temp</span>
							{/if}
							<span class="truncate">{ws}</span>
						</span>
						{#if ws === activeWs}
							<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
						{/if}
					</button>

					{#if onDeleteWorkspace && (ws.startsWith('temp-') || ws === 'demo-project')}
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
				<div class="text-[11px] text-zinc-600 italic py-2 text-center font-mono">No workspaces yet. Click Clone to add one.</div>
			{/each}
		</div>
	</div>

	<!-- Active Repo Status -->
	{#if activeWs === 'auto-temp'}
		<div class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3.5 flex flex-col gap-2 text-xs">
			<div class="flex items-center gap-1.5 text-amber-300 font-semibold font-mono">
				<span>✨ Auto Temp Mode</span>
			</div>
			<div class="text-[11px] text-zinc-400 leading-relaxed font-sans">
				ระบบจะสร้าง Workspace ใหม่ให้ทันที โดยตั้งชื่อโฟลเดอร์ตามคำถามที่พิมพ์
			</div>
		</div>
	{:else if wsDetails}
		<div class="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3.5 flex flex-col gap-2 text-xs">
			<div class="flex items-center justify-between font-mono">
				<div class="flex items-center gap-1.5 text-zinc-300">
					<GitBranch class="w-3 h-3 text-zinc-400" />
					<span class="font-semibold">{wsDetails.branch}</span>
				</div>
				<span class="text-[10px] px-1.5 py-0.5 rounded font-mono {wsDetails.clean ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-300 border border-amber-500/20'}">
					{wsDetails.statusSummary}
				</span>
			</div>

			<div class="text-[11px] text-zinc-500 flex justify-between pt-1 border-t border-zinc-800/60 font-mono">
				<span>Tracked Files</span>
				<span class="text-zinc-300">{wsDetails.files.length}</span>
			</div>
		</div>
	{/if}
</div>
