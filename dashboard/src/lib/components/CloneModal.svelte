<script lang="ts">
	interface Props {
		open: boolean;
		onClose: () => void;
		onClone: (repoUrl: string, folderName: string) => Promise<void>;
		isCloning: boolean;
	}

	let { open, onClose, onClone, isCloning }: Props = $props();

	let cloneUrl = $state<string>('');
	let cloneFolder = $state<string>('');

	function handleFormSubmit() {
		if (!cloneUrl.trim() || isCloning) return;
		onClone(cloneUrl.trim(), cloneFolder.trim());
	}
</script>

{#if open}
	<div class="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
		<div class="bg-zinc-900 border border-zinc-800 rounded-lg max-w-sm w-full p-5 flex flex-col gap-3 shadow-xl text-xs">
			<div class="flex items-center justify-between">
				<span class="font-semibold text-zinc-200">Clone Repository</span>
				<button onclick={onClose} class="text-zinc-500 hover:text-zinc-300 text-sm cursor-pointer">&times;</button>
			</div>

			<div class="flex flex-col gap-2.5">
				<div>
					<label for="clone-url-field" class="text-zinc-400 block mb-1 text-[11px]">Git URL</label>
					<input 
						id="clone-url-field"
						type="text" 
						bind:value={cloneUrl}
						placeholder="https://github.com/..." 
						class="w-full px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-700"
					/>
				</div>
				<div>
					<label for="clone-target-folder" class="text-zinc-400 block mb-1 text-[11px]">Folder (optional)</label>
					<input 
						id="clone-target-folder"
						type="text" 
						bind:value={cloneFolder}
						placeholder="folder-name" 
						class="w-full px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-700"
					/>
				</div>
			</div>

			<div class="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
				<button 
					onclick={onClose} 
					class="px-2.5 py-1 text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
				>
					Cancel
				</button>
				<button 
					onclick={handleFormSubmit}
					disabled={isCloning || !cloneUrl.trim()}
					class="px-3 py-1 bg-zinc-100 hover:bg-white text-zinc-950 font-medium rounded transition cursor-pointer disabled:opacity-50"
				>
					{isCloning ? 'Cloning...' : 'Clone'}
				</button>
			</div>
		</div>
	</div>
{/if}
