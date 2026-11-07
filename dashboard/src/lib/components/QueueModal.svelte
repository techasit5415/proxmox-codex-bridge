<script lang="ts">
	import { Layers, RefreshCw, X, Eye, Trash2, Clock, CheckCircle2 } from 'lucide-svelte';
	import type { TaskJobData } from '../types';

	interface Props {
		isOpen: boolean;
		activeJobs: TaskJobData[];
		redisStatus?: string;
		onClose: () => void;
		onRefresh: () => void;
		onWatchJob?: (job: TaskJobData) => void;
		onCancelJob?: (taskId: string) => Promise<void>;
	}

	let {
		isOpen,
		activeJobs = [],
		redisStatus = 'online',
		onClose,
		onRefresh,
		onWatchJob,
		onCancelJob
	}: Props = $props();

	let runningJobs = $derived(activeJobs.filter((j) => j.status === 'running'));
	let queuedJobs = $derived(activeJobs.filter((j) => j.status === 'queued'));

	function getProviderBadge(provider: string) {
		const p = (provider || '').toLowerCase();
		if (p === 'consensus' || p.includes('consensus')) {
			return { label: 'Consensus', class: 'bg-zinc-800 text-amber-300 border border-zinc-700' };
		}
		if (p === 'both' || p.includes('dual')) {
			return { label: 'Dual Compare', class: 'bg-zinc-800 text-indigo-300 border border-zinc-700' };
		}
		if (p.includes('deepseek')) {
			return { label: 'DeepSeek R1', class: 'bg-zinc-800 text-violet-300 border border-zinc-700' };
		}
		return { label: 'Codex', class: 'bg-zinc-800 text-emerald-300 border border-zinc-700' };
	}

	function formatElapsed(startTs?: number): string {
		if (!startTs) return 'just started';
		const sec = Math.max(1, Math.floor((Date.now() - startTs) / 1000));
		if (sec < 60) return `${sec}s`;
		const min = Math.floor(sec / 60);
		const rem = sec % 60;
		return `${min}m ${rem}s`;
	}

	function formatWorkspace(ws?: string): string {
		if (!ws || ws === 'auto-temp' || ws === 'temp' || ws === 'all') return 'Auto Temp';
		if (ws.startsWith('temp-')) return ws.replace(/^temp-/, '').replace(/-[a-z0-9]{4}$/i, '');
		return ws;
	}
</script>

{#if isOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
		<div class="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
			<!-- Modal Header -->
			<div class="px-5 py-3.5 border-b border-zinc-800 bg-zinc-900/60 flex items-center justify-between">
				<div class="flex items-center gap-2.5">
					<div class="size-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center">
						<Layers class="size-4 text-zinc-300" strokeWidth={1.5} />
					</div>
					<div>
						<h3 class="text-sm font-semibold text-zinc-100 flex items-center gap-2">
							<span>Job Queue</span>
							<span class="text-[10px] px-2 py-0.5 rounded-full font-mono {redisStatus === 'online' ? 'bg-zinc-800 text-emerald-400 border border-zinc-700' : 'bg-rose-950 text-rose-300 border border-rose-800'}">
								Redis: {redisStatus}
							</span>
						</h3>
						<p class="text-[11px] text-zinc-400">
							Active worker tasks and queue status
						</p>
					</div>
				</div>

				<div class="flex items-center gap-1.5">
					<button
						onclick={onRefresh}
						class="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors cursor-pointer"
						title="Refresh queue"
					>
						<RefreshCw class="size-3.5" strokeWidth={1.5} />
					</button>
					<button
						onclick={onClose}
						class="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors cursor-pointer"
						title="Close"
					>
						<X class="size-4" strokeWidth={1.5} />
					</button>
				</div>
			</div>

			<!-- Summary Bar -->
			<div class="px-5 py-2.5 bg-zinc-900/30 border-b border-zinc-800 flex items-center justify-between text-xs font-mono">
				<div class="flex items-center gap-4">
					<span class="flex items-center gap-1.5">
						<span class="size-2 rounded-full {runningJobs.length > 0 ? 'bg-emerald-400' : 'bg-zinc-600'}"></span>
						<span class="text-zinc-400">Processing:</span>
						<strong class="text-emerald-400">{runningJobs.length}</strong>
					</span>
					<span class="text-zinc-700">|</span>
					<span class="flex items-center gap-1.5">
						<Clock class="size-3.5 text-zinc-400" strokeWidth={1.5} />
						<span class="text-zinc-400">Queued:</span>
						<strong class="text-zinc-200">{queuedJobs.length}</strong>
					</span>
				</div>
				<span class="text-[10px] text-zinc-500 font-sans">Auto-refreshed</span>
			</div>

			<!-- Body -->
			<div class="p-5 overflow-y-auto flex-1 flex flex-col gap-5">
				{#if runningJobs.length === 0 && queuedJobs.length === 0}
					<div class="py-12 text-center flex flex-col items-center justify-center gap-2.5">
						<div class="size-10 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
							<CheckCircle2 class="size-5 text-zinc-400" strokeWidth={1.5} />
						</div>
						<div class="text-xs font-medium text-zinc-300">No active tasks in queue</div>
						<p class="text-[11px] text-zinc-500 max-w-sm">
							Bridge worker is idle and ready for new instructions.
						</p>
					</div>
				{:else}
					<!-- Running Jobs Section -->
					{#if runningJobs.length > 0}
						<div class="flex flex-col gap-2">
							<div class="text-xs font-medium text-zinc-300">
								Running ({runningJobs.length})
							</div>

							{#each runningJobs as job}
								{@const badge = getProviderBadge(job.provider)}
								<div class="p-3 rounded-xl border border-zinc-800 bg-zinc-900/60 flex flex-col gap-2">
									<div class="flex items-center justify-between gap-2 flex-wrap text-xs font-mono">
										<div class="flex items-center gap-2 flex-wrap">
											<span class="px-2 py-0.5 rounded font-medium text-[11px] {badge.class}">
												{badge.label}
											</span>
											<span class="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-300 text-[11px]">
												{formatWorkspace(job.workspace)}
											</span>
											<span class="text-[10px] text-zinc-500">{job.id}</span>
										</div>
										<span class="text-[11px] text-zinc-400 font-sans">
											Elapsed: {formatElapsed(job.startedAt || job.createdAt)}
										</span>
									</div>

									<!-- Live Stage Banner -->
									<div class="px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 font-mono flex items-center justify-between gap-2">
										<div class="flex items-center gap-2 truncate">
											<RefreshCw class="size-3 animate-spin text-zinc-400 shrink-0" strokeWidth={1.5} />
											<span class="truncate">{job.stage || 'Executing task...'}</span>
										</div>
										{#if onWatchJob}
											<button
												onclick={() => { onWatchJob(job); onClose(); }}
												class="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-[11px] font-sans font-medium flex items-center gap-1 cursor-pointer shrink-0 transition-colors"
											>
												<Eye class="size-3" strokeWidth={1.5} />
												<span>Watch stream</span>
											</button>
										{/if}
									</div>

									<!-- Prompt Text -->
									<div class="text-xs text-zinc-300 font-sans bg-zinc-950/80 p-2.5 rounded-lg border border-zinc-850 whitespace-pre-wrap max-h-28 overflow-y-auto leading-relaxed">
										{job.prompt}
									</div>
								</div>
							{/each}
						</div>
					{/if}

					<!-- Queued / Waiting Jobs Section -->
					{#if queuedJobs.length > 0}
						<div class="flex flex-col gap-2">
							<div class="text-xs font-medium text-zinc-300">
								Queued ({queuedJobs.length})
							</div>

							{#each queuedJobs as job, idx}
								{@const badge = getProviderBadge(job.provider)}
								<div class="p-3 rounded-xl border border-zinc-850 bg-zinc-900/40 flex flex-col gap-2">
									<div class="flex items-center justify-between gap-2 flex-wrap text-xs font-mono">
										<div class="flex items-center gap-2 flex-wrap">
											<span class="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 text-[11px] font-medium">
												#{idx + 1}
											</span>
											<span class="px-2 py-0.5 rounded font-medium text-[11px] {badge.class}">
												{badge.label}
											</span>
											<span class="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-300 text-[11px]">
												{formatWorkspace(job.workspace)}
											</span>
										</div>

										<div class="flex items-center gap-2">
											<span class="text-[11px] text-zinc-400 font-sans">
												Waiting: {formatElapsed(job.createdAt)}
											</span>
											{#if onCancelJob}
												<button
													onclick={() => onCancelJob(job.id)}
													class="px-2 py-0.5 rounded bg-zinc-850 hover:bg-rose-950/60 text-zinc-400 hover:text-rose-300 border border-zinc-700 text-[11px] font-sans flex items-center gap-1 cursor-pointer transition-colors"
													title="Cancel task"
												>
													<Trash2 class="size-3" strokeWidth={1.5} />
													<span>Cancel</span>
												</button>
											{/if}
										</div>
									</div>

									<div class="text-xs text-zinc-300 font-sans bg-zinc-950/80 p-2.5 rounded-lg border border-zinc-850 whitespace-pre-wrap max-h-24 overflow-y-auto leading-relaxed">
										{job.prompt}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				{/if}
			</div>

			<!-- Footer -->
			<div class="px-5 py-3 border-t border-zinc-800 bg-zinc-900/40 flex items-center justify-end text-xs text-zinc-400">
				<button
					onclick={onClose}
					class="px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium cursor-pointer transition-colors"
				>
					Close
				</button>
			</div>
		</div>
	</div>
{/if}
