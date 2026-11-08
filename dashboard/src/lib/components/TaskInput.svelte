<script lang="ts">
	import { Play, RefreshCw, Layers, Clock, Plus, GitBranch, Folder, GitMerge, X, Paperclip, FileText, Image as ImageIcon } from 'lucide-svelte';
	import { detectTaskType } from '../types';
	import type { AIModelConfig, TaskAttachmentInput } from '../types';

	interface Props {
		prompt: string;
		branch: string;
		provider: string;
		attachments?: TaskAttachmentInput[];
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
		attachments = $bindable([]),
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
	let isDraggingOver = $state<boolean>(false);
	let fileInputEl = $state<HTMLInputElement | null>(null);

	let activeModels = $derived(models.filter(m => m.active));
	let projectWorkspaces = $derived(workspaces.filter(w => !w.startsWith('temp-')));
	let isWorkspaceActive = $derived(Boolean(activeWs && activeWs !== 'all' && activeWs !== 'auto-temp'));

	function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			onExecute();
		}
	}

	function formatSize(b64: string): string {
		const bytes = Math.round((b64.length * 3) / 4);
		if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	}

	async function readFilesAsAttachments(fileList: FileList | null) {
		if (!fileList || fileList.length === 0) return;
		const newItems: TaskAttachmentInput[] = [];
		for (const file of Array.from(fileList)) {
			if (file.size > 40 * 1024 * 1024) {
				alert(`ไฟล์ "${file.name}" มีขนาดเกิน 40MB`);
				continue;
			}
			const b64 = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => {
					const res = typeof reader.result === 'string' ? reader.result : '';
					const clean = res.includes(',') ? res.split(',').pop() || '' : res;
					resolve(clean);
				};
				reader.onerror = () => reject(reader.error);
				reader.readAsDataURL(file);
			});
			newItems.push({
				name: file.name,
				mimeType: file.type || 'application/octet-stream',
				contentBase64: b64
			});
		}
		attachments = [...attachments, ...newItems].slice(0, 15);
		if (fileInputEl) fileInputEl.value = '';
	}

	function removeAttachment(index: number) {
		attachments = attachments.filter((_, idx) => idx !== index);
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		isDraggingOver = false;
		if (e.dataTransfer?.files?.length) {
			readFilesAsAttachments(e.dataTransfer.files);
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	ondragover={(e) => { e.preventDefault(); isDraggingOver = true; }}
	ondragleave={() => { isDraggingOver = false; }}
	ondrop={handleDrop}
	class="rounded-xl border transition-colors p-3.5 flex flex-col gap-3 {isDraggingOver ? 'border-indigo-500 bg-indigo-950/20' : 'border-zinc-800/90 bg-zinc-900/40'}"
>
	{#if selectedTaskId}
		<div class="flex items-center justify-between px-3 py-1.5 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-xs">
			<div class="flex items-center gap-2 text-zinc-300">
				<Clock class="size-3.5 text-zinc-400 shrink-0" strokeWidth={1.5} />
				<span>Viewing task from history</span>
			</div>
			<button 
				onclick={onClearSelected}
				class="px-2 py-0.5 rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-200 border border-zinc-600 text-[11px] transition-colors font-medium flex items-center gap-1 cursor-pointer shrink-0"
			>
				<Plus class="size-3" strokeWidth={1.5} />
				<span>New task</span>
			</button>
		</div>
	{/if}

	<!-- Top Row: Prompt Label + Workspace Selector + Provider Segmented Control -->
	<div class="flex items-center justify-between text-xs flex-wrap gap-2">
		<div class="flex items-center gap-2 flex-wrap">
			<span class="font-medium text-zinc-200 text-xs">Prompt</span>

			<!-- Single Clean Workspace Selector -->
			{#if isWorkspaceActive}
				<div class="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-200 border border-zinc-700 text-[11px] font-mono">
					<Folder class="size-3 text-zinc-400 shrink-0" strokeWidth={1.5} />
					<span>{activeWs}</span>
					{#if onSelectWorkspace}
						<button
							onclick={() => onSelectWorkspace('all')}
							title="Untick workspace (run without workspace)"
							class="text-zinc-400 hover:text-zinc-100 transition-colors ml-0.5 cursor-pointer"
						>
							<X class="size-3" strokeWidth={1.5} />
						</button>
					{/if}
				</div>
			{:else if onSelectWorkspace && projectWorkspaces.length > 0}
				<select
					value={activeWs}
					onchange={(e) => onSelectWorkspace((e.currentTarget as HTMLSelectElement).value)}
					class="bg-zinc-950 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-700 rounded-md px-2 py-0.5 text-[11px] font-mono focus:outline-none cursor-pointer transition-colors"
					title="Target workspace"
				>
					<option value="all">Workspace: None</option>
					{#each projectWorkspaces as ws}
						<option value={ws}>{ws}</option>
					{/each}
				</select>
			{/if}

			{#if prompt.trim()}
				{@const taskType = detectTaskType(prompt)}
				<span class="text-[10px] px-1.5 py-0.2 rounded font-mono border border-zinc-800 bg-zinc-950 text-zinc-400">
					{taskType === 'code' ? 'Code' : 'Analysis'}
				</span>
			{/if}
		</div>

		<!-- Segmented Control: Choose Provider -->
		<div class="flex rounded-lg bg-zinc-950 p-0.5 border border-zinc-800 text-[11px] font-medium flex-wrap gap-0.5">
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
					Codex
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

	<!-- Prompt Textarea -->
	<textarea 
		bind:value={prompt}
		onkeydown={handleKeydown}
		rows="3"
		placeholder="Ask a question, describe a change, or drop files (PDF, DOCX, Images, Code) here... (⌘Enter to run)"
		class="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-zinc-600 resize-y font-sans placeholder:text-zinc-500 leading-relaxed"
	></textarea>

	<!-- Attached Files Pills -->
	{#if attachments.length > 0}
		<div class="flex items-center gap-1.5 flex-wrap pt-0.5">
			<span class="text-[11px] text-indigo-300 font-medium mr-1">ไฟล์แนบที่จะส่งให้โมเดลตรวจจริง ({attachments.length}):</span>
			{#each attachments as att, idx}
				{@const isImg = /\.(png|jpe?g|webp|gif)$/i.test(att.name)}
				<div class="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-950/50 border border-indigo-500/40 text-indigo-200 text-[11px] font-mono">
					{#if isImg}
						<ImageIcon class="size-3 text-indigo-400 shrink-0" strokeWidth={1.5} />
					{:else}
						<FileText class="size-3 text-indigo-400 shrink-0" strokeWidth={1.5} />
					{/if}
					<span class="max-w-[200px] truncate" title={att.name}>{att.name}</span>
					<span class="text-[10px] text-indigo-400/80">({formatSize(att.contentBase64)})</span>
					<button
						type="button"
						onclick={() => removeAttachment(idx)}
						class="text-indigo-400 hover:text-rose-400 transition-colors ml-0.5 cursor-pointer"
						title="ลบไฟล์แนบ"
					>
						<X class="size-3" strokeWidth={1.5} />
					</button>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Bottom Action Bar -->
	<div class="flex items-center justify-between gap-3 pt-0.5 flex-wrap">
		<div class="flex items-center gap-2 flex-wrap">
			<input
				bind:this={fileInputEl}
				type="file"
				multiple
				accept=".pdf,.docx,.txt,.md,.csv,.json,.py,.ts,.js,.svelte,.html,.css,.tex,.log,.png,.jpg,.jpeg,.webp,.gif"
				onchange={(e) => readFilesAsAttachments((e.currentTarget as HTMLInputElement).files)}
				class="hidden"
			/>
			<button
				type="button"
				onclick={() => fileInputEl?.click()}
				class="text-[11px] px-2.5 py-1 rounded-md bg-zinc-950 border border-zinc-800 hover:border-indigo-500/50 text-zinc-300 hover:text-indigo-200 transition-colors flex items-center gap-1.5 cursor-pointer"
				title="แนบไฟล์จริง (PDF, DOCX, รูปภาพ, โค้ด) เพื่อให้ทั้ง Codex และ DeepSeek ตรวจสอบจากไฟล์ต้นฉบับ"
			>
				<Paperclip class="size-3 text-indigo-400" strokeWidth={1.5} />
				<span>แนบไฟล์ (PDF / รูป / โค้ด)</span>
			</button>

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
					placeholder={provider === 'both' ? 'agent/codex-* & agent/deepseek-*' : 'git branch name'}
					class="px-2.5 py-1 bg-zinc-950 border border-zinc-700 rounded-md text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-500 placeholder:text-zinc-600 w-56"
				/>
			{/if}
		</div>

		<button 
			onclick={onExecute}
			disabled={isExecuting || !prompt.trim()}
			class="h-8 px-4 rounded-lg bg-zinc-100 hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 font-medium text-xs transition-colors flex items-center gap-2 cursor-pointer shrink-0"
		>
			{#if isExecuting}
				<RefreshCw class="size-3 animate-spin" strokeWidth={1.5} />
				<span>Executing...</span>
			{:else}
				<Play class="size-3 fill-current" strokeWidth={1.5} />
				<span>Run</span>
				<kbd class="text-[10px] opacity-60 font-mono">⌘↵</kbd>
			{/if}
		</button>
	</div>
</div>
