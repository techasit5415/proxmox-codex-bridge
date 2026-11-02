<script lang="ts">
	interface Props {
		activeWs: string;
		onRunCommand: (cmd: string) => Promise<void>;
		isRunning: boolean;
	}

	let { activeWs, onRunCommand, isRunning }: Props = $props();
	let cmd = $state<string>('');

	function handleRun() {
		if (!cmd.trim() || isRunning) return;
		const toRun = cmd;
		cmd = '';
		onRunCommand(toRun);
	}
</script>

<div class="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 flex flex-col gap-2">
	<span class="text-[11px] font-medium text-zinc-400">Quick Command</span>
	<div class="flex gap-1.5">
		<input 
			type="text" 
			bind:value={cmd}
			placeholder="npm test, git status..."
			onkeydown={(e) => e.key === 'Enter' && handleRun()}
			class="w-full px-2.5 py-1 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-700 placeholder:text-zinc-600"
		/>
		<button 
			onclick={handleRun}
			disabled={isRunning || !cmd.trim()}
			class="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-xs rounded font-medium text-zinc-300 transition cursor-pointer"
		>
			{isRunning ? '...' : 'Run'}
		</button>
	</div>
</div>
