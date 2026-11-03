<script lang="ts">
	import { Layers, RefreshCw, X, Eye, Trash2, Clock, PlayCircle, CheckCircle2 } from 'lucide-svelte';
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
			return { label: '🏆 Consensus (3 ขั้นตอน)', class: 'bg-amber-950/80 text-amber-300 border border-amber-700/80' };
		}
		if (p === 'both' || p.includes('dual')) {
			return { label: '⚡ Dual Compare', class: 'bg-indigo-950/80 text-indigo-300 border border-indigo-700/80' };
		}
		if (p.includes('deepseek')) {
			return { label: '🧠 DeepSeek R1', class: 'bg-violet-950/80 text-violet-300 border border-violet-700/80' };
		}
		return { label: '🤖 Codex (gpt-6.1-sol)', class: 'bg-emerald-950/70 text-emerald-300 border border-emerald-700/70' };
	}

	function formatElapsed(startTs?: number): string {
		if (!startTs) return 'เพิ่งเริ่ม';
		const sec = Math.max(1, Math.floor((Date.now() - startTs) / 1000));
		if (sec < 60) return `${sec} วินาที`;
		const min = Math.floor(sec / 60);
		const rem = sec % 60;
		return `${min} นาที ${rem} วินาที`;
	}

	function formatWorkspace(ws?: string): string {
		if (!ws || ws === 'auto-temp' || ws === 'temp' || ws === 'all') return '✨ Auto Temp';
		if (ws.startsWith('temp-')) return '✨ ' + ws.replace(/^temp-/, '').replace(/-[a-z0-9]{4}$/i, '');
		return '📁 ' + ws;
	}
</script>

{#if isOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
		<div class="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
			<!-- Modal Header -->
			<div class="px-5 py-3.5 border-b border-zinc-800 bg-zinc-900/60 flex items-center justify-between">
				<div class="flex items-center gap-2.5">
					<div class="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
						<Layers class="w-4 h-4 text-cyan-400" />
					</div>
					<div>
						<h3 class="text-sm font-bold text-zinc-100 flex items-center gap-2">
							<span>คิวงานสด (Live Redis Job Queue)</span>
							<span class="text-[10px] px-2 py-0.5 rounded-full font-mono {redisStatus === 'online' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'}">
								Redis: {redisStatus}
							</span>
						</h3>
						<p class="text-[11px] text-zinc-400">
							ตรวจสอบว่ากำลังรันงานอะไรอยู่ อยู่ขั้นตอนไหน และมีงานใดรอคิวถัดไปบ้าง (อัปเดตอัตโนมัติ)
						</p>
					</div>
				</div>

				<div class="flex items-center gap-1.5">
					<button
						onclick={onRefresh}
						class="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition cursor-pointer"
						title="รีเฟรชข้อมูลคิวทันที"
					>
						<RefreshCw class="w-3.5 h-3.5" />
					</button>
					<button
						onclick={onClose}
						class="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition cursor-pointer"
						title="ปิดหน้าต่าง"
					>
						<X class="w-4 h-4" />
					</button>
				</div>
			</div>

			<!-- Summary Bar -->
			<div class="px-5 py-2.5 bg-zinc-900/30 border-b border-zinc-800/80 flex items-center justify-between text-xs font-mono">
				<div class="flex items-center gap-4">
					<span class="flex items-center gap-1.5">
						<span class="w-2 h-2 rounded-full {runningJobs.length > 0 ? 'bg-emerald-400 animate-ping' : 'bg-zinc-600'}"></span>
						<span class="text-zinc-400">กำลังรัน (In-Flight):</span>
						<strong class="text-emerald-400">{runningJobs.length} งาน</strong>
					</span>
					<span class="text-zinc-700">|</span>
					<span class="flex items-center gap-1.5">
						<Clock class="w-3.5 h-3.5 text-amber-400" />
						<span class="text-zinc-400">รอคิว (Waiting):</span>
						<strong class="text-amber-300">{queuedJobs.length} งาน</strong>
					</span>
				</div>
				<span class="text-[10px] text-zinc-500 font-sans">อัปเดตสดทุก 2.5 วินาที</span>
			</div>

			<!-- Body -->
			<div class="p-5 overflow-y-auto flex-1 flex flex-col gap-5">
				{#if runningJobs.length === 0 && queuedJobs.length === 0}
					<div class="py-12 text-center flex flex-col items-center justify-center gap-2.5">
						<div class="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
							<CheckCircle2 class="w-6 h-6 text-emerald-400" />
						</div>
						<div class="text-sm font-bold text-zinc-200">ไม่มีงานค้างในคิวขณะนี้</div>
						<p class="text-xs text-zinc-400 max-w-md">
							Worker บน Proxmox CT ว่างและพร้อมรับคำสั่งใหม่ทันที หากคุณสั่งรันงานจากหน้าเว็บหรือ CLI (`ask_models.py`) งานจะปรากฏที่นี่แบบ Real-time
						</p>
					</div>
				{:else}
					<!-- Running Jobs Section -->
					{#if runningJobs.length > 0}
						<div class="flex flex-col gap-2.5">
							<div class="flex items-center gap-1.5 text-xs font-bold text-emerald-400 uppercase tracking-wider font-mono">
								<PlayCircle class="w-3.5 h-3.5 animate-spin" />
								<span>กำลังประมวลผลอยู่ตอนนี้ ({runningJobs.length})</span>
							</div>

							{#each runningJobs as job}
								{@const badge = getProviderBadge(job.provider)}
								<div class="p-3.5 rounded-xl border border-emerald-500/40 bg-emerald-950/15 flex flex-col gap-2.5">
									<div class="flex items-center justify-between gap-2 flex-wrap text-xs font-mono">
										<div class="flex items-center gap-2 flex-wrap">
											<span class="px-2 py-0.5 rounded font-semibold text-[11px] {badge.class}">
												{badge.label}
											</span>
											<span class="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-300 text-[11px]">
												{formatWorkspace(job.workspace)}
											</span>
											<span class="text-[10px] text-zinc-500">{job.id}</span>
										</div>
										<span class="text-[11px] text-emerald-300 font-sans">
											⏱️ รันมาแล้ว {formatElapsed(job.startedAt || job.createdAt)}
										</span>
									</div>

									<!-- Live Stage Banner -->
									<div class="px-3 py-1.5 rounded-lg bg-zinc-900/90 border border-emerald-500/30 text-xs text-amber-300 font-mono flex items-center justify-between gap-2">
										<div class="flex items-center gap-2 truncate">
											<RefreshCw class="w-3.5 h-3.5 animate-spin text-emerald-400 shrink-0" />
											<span class="truncate">{job.stage || 'กำลังรันโมเดลบน Proxmox CT...'}</span>
										</div>
										{#if onWatchJob}
											<button
												onclick={() => { onWatchJob(job); onClose(); }}
												class="px-2.5 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/40 text-[11px] font-sans font-semibold flex items-center gap-1 cursor-pointer shrink-0 transition"
											>
												<Eye class="w-3 h-3" />
												<span>เกาะดูสตรีมสด</span>
											</button>
										{/if}
									</div>

									<!-- Prompt Text -->
									<div class="text-xs text-zinc-200 font-sans bg-zinc-950/70 p-2.5 rounded-lg border border-zinc-800/80 whitespace-pre-wrap max-h-28 overflow-y-auto leading-relaxed">
										{job.prompt}
									</div>
								</div>
							{/each}
						</div>
					{/if}

					<!-- Queued / Waiting Jobs Section -->
					{#if queuedJobs.length > 0}
						<div class="flex flex-col gap-2.5">
							<div class="flex items-center gap-1.5 text-xs font-bold text-amber-300 uppercase tracking-wider font-mono">
								<Clock class="w-3.5 h-3.5" />
								<span>คิวที่รอประมวลผลถัดไป ({queuedJobs.length})</span>
							</div>

							{#each queuedJobs as job, idx}
								{@const badge = getProviderBadge(job.provider)}
								<div class="p-3.5 rounded-xl border border-amber-500/30 bg-amber-950/10 flex flex-col gap-2">
									<div class="flex items-center justify-between gap-2 flex-wrap text-xs font-mono">
										<div class="flex items-center gap-2 flex-wrap">
											<span class="px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/40 font-bold text-[11px]">
												คิวที่ #{idx + 1}
											</span>
											<span class="px-2 py-0.5 rounded font-semibold text-[11px] {badge.class}">
												{badge.label}
											</span>
											<span class="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-300 text-[11px]">
												{formatWorkspace(job.workspace)}
											</span>
										</div>

										<div class="flex items-center gap-2">
											<span class="text-[11px] text-zinc-400 font-sans">
												🕒 รอมาแล้ว {formatElapsed(job.createdAt)}
											</span>
											{#if onCancelJob}
												<button
													onclick={() => onCancelJob(job.id)}
													class="px-2 py-0.5 rounded bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800/60 text-[11px] font-sans flex items-center gap-1 cursor-pointer transition"
													title="ยกเลิกงานนี้จากคิวรอ"
												>
													<Trash2 class="w-3 h-3" />
													<span>ยกเลิกคิว</span>
												</button>
											{/if}
										</div>
									</div>

									<div class="text-xs text-zinc-200 font-sans bg-zinc-950/70 p-2.5 rounded-lg border border-zinc-800/80 whitespace-pre-wrap max-h-24 overflow-y-auto leading-relaxed">
										{job.prompt}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				{/if}
			</div>

			<!-- Footer -->
			<div class="px-5 py-3 border-t border-zinc-800 bg-zinc-900/40 flex items-center justify-between text-[11px] text-zinc-400">
				<span>💡 คุณสามารถกดที่ปุ่ม <strong>"คิว: X รอ · Y รัน"</strong> ด้านบนของหน้าเว็บได้ตลอดเวลาเพื่อเปิดหน้าต่างนี้</span>
				<button
					onclick={onClose}
					class="px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium cursor-pointer transition"
				>
					ปิดหน้าต่าง
				</button>
			</div>
		</div>
	</div>
{/if}
