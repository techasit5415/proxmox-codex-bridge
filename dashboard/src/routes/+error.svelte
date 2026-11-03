<script lang="ts">
	import { page } from '$app/state';
	import { RotateCcw, AlertTriangle, ChevronDown } from 'lucide-svelte';

	let showDetails = $state(false);
</script>

<div class="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6 font-sans">
	<div class="max-w-lg w-full bg-zinc-900/90 border border-zinc-800 rounded-2xl p-8 text-center shadow-2xl backdrop-blur-xl">
		<div class="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-5">
			<AlertTriangle class="w-7 h-7" />
		</div>

		<h1 class="text-3xl font-extrabold text-zinc-100 mb-2 font-mono">
			{page.status}
		</h1>
		
		<p class="text-zinc-400 text-sm mb-6 leading-relaxed">
			{page.error?.message || 'เกิดข้อผิดพลาดในการโหลดหน้าเว็บ กรุณารีเฟรชเพื่อลองใหม่อีกครั้ง'}
		</p>

		<div class="flex flex-col sm:flex-row gap-3 justify-center mb-4">
			<button
				onclick={() => window.location.reload()}
				class="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition shadow-lg shadow-indigo-600/20 cursor-pointer"
			>
				<RotateCcw class="w-4 h-4" />
				รีเฟรชหน้าเว็บ (Reload)
			</button>

			<a
				href="/"
				class="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium text-sm transition"
			>
				กลับหน้าแรก
			</a>
		</div>

		{#if page.error}
			<div class="mt-4 pt-4 border-t border-zinc-800/80 text-left">
				<button 
					onclick={() => (showDetails = !showDetails)} 
					class="text-[11px] text-zinc-500 hover:text-zinc-300 transition flex items-center gap-1 cursor-pointer font-mono"
				>
					<ChevronDown class="w-3.5 h-3.5 transition-transform {showDetails ? 'rotate-180' : ''}" />
					<span>รายละเอียดข้อผิดพลาด (Technical Details)</span>
				</button>
				{#if showDetails}
					<pre class="mt-2 p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-[10px] font-mono text-rose-300/80 overflow-x-auto whitespace-pre-wrap max-h-48">{JSON.stringify(page.error, null, 2)}</pre>
				{/if}
			</div>
		{/if}
	</div>
</div>
