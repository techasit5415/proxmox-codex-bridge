<script lang="ts">
	import { X, Plus, Trash2, Check, AlertCircle, RefreshCw, Key, Globe, Cpu, Sparkles } from 'lucide-svelte';
	import type { AIModelConfig } from '../types';

	interface Props {
		isOpen: boolean;
		models: AIModelConfig[];
		onClose: () => void;
		onModelsUpdated: () => void;
	}

	let { isOpen, models, onClose, onModelsUpdated }: Props = $props();

	// Presets
	const PRESETS = [
		{
			label: 'Claude 3.5 Sonnet (Anthropic)',
			type: 'anthropic' as const,
			name: 'Claude 3.5 Sonnet',
			badge: 'Claude 3.5',
			modelId: 'claude-3-5-sonnet-20241022',
			endpoint: 'https://api.anthropic.com/v1/messages',
			color: 'orange'
		},
		{
			label: 'Claude 3.7 Sonnet (Anthropic)',
			type: 'anthropic' as const,
			name: 'Claude 3.7 Sonnet',
			badge: 'Claude 3.7',
			modelId: 'claude-3-7-sonnet',
			endpoint: 'https://api.anthropic.com/v1/messages',
			color: 'orange'
		},
		{
			label: 'GPT-4o (OpenAI)',
			type: 'openai-compatible' as const,
			name: 'GPT-4o (OpenAI)',
			badge: 'GPT-4o',
			modelId: 'gpt-4o',
			endpoint: 'https://api.openai.com/v1/chat/completions',
			color: 'emerald'
		},
		{
			label: 'Gemini 2.0 Flash (Google)',
			type: 'openai-compatible' as const,
			name: 'Gemini 2.0 Flash',
			badge: 'Gemini 2.0',
			modelId: 'gemini-2.0-flash',
			endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
			color: 'blue'
		},
		{
			label: 'OpenRouter (Any Model)',
			type: 'openai-compatible' as const,
			name: 'OpenRouter Model',
			badge: 'OpenRouter',
			modelId: 'anthropic/claude-3.5-sonnet',
			endpoint: 'https://openrouter.ai/api/v1/chat/completions',
			color: 'indigo'
		},
		{
			label: 'Custom Local Ollama / vLLM',
			type: 'ollama' as const,
			name: 'Local Ollama Model',
			badge: 'Ollama',
			modelId: 'llama3:latest',
			endpoint: 'http://localhost:11434/api/chat',
			color: 'cyan'
		}
	];

	let isAdding = $state<boolean>(false);
	let selectedPreset = $state<string>(PRESETS[0].label);

	// Form State
	let formId = $state<string>('');
	let formName = $state<string>(PRESETS[0].name);
	let formBadge = $state<string>(PRESETS[0].badge);
	let formType = $state<'cli' | 'anthropic' | 'openai-compatible' | 'ollama'>('anthropic');
	let formEndpoint = $state<string>(PRESETS[0].endpoint);
	let formModelId = $state<string>(PRESETS[0].modelId);
	let formApiKey = $state<string>('');
	let formColor = $state<string>(PRESETS[0].color);
	let formInConsensus = $state<boolean>(true);

	// Test & Save State
	let isTesting = $state<boolean>(false);
	let testResult = $state<{ success: boolean; message: string } | null>(null);
	let isSaving = $state<boolean>(false);

	function applyPreset(label: string) {
		selectedPreset = label;
		const preset = PRESETS.find(p => p.label === label);
		if (!preset) return;
		formType = preset.type;
		formName = preset.name;
		formBadge = preset.badge;
		formModelId = preset.modelId;
		formEndpoint = preset.endpoint;
		formColor = preset.color;
		formId = preset.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
		testResult = null;
	}

	function startAddNew() {
		isAdding = true;
		applyPreset(PRESETS[0].label);
		formApiKey = '';
		testResult = null;
	}

	async function testConnection() {
		isTesting = true;
		testResult = null;
		try {
			const res = await fetch('/api/models', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'test',
					model: {
						id: formId || 'test-model',
						name: formName,
						type: formType,
						endpoint: formEndpoint,
						apiKey: formApiKey,
						modelId: formModelId
					}
				})
			});
			const d = await res.json();
			testResult = d.success 
				? { success: true, message: d.message || 'Connected successfully!' }
				: { success: false, message: d.error || 'Connection failed' };
		} catch (e: any) {
			testResult = { success: false, message: e.message };
		} finally {
			isTesting = false;
		}
	}

	async function saveModel() {
		if (!formName.trim() || !formModelId.trim()) {
			alert('กรุณากรอกชื่อและ Model ID');
			return;
		}
		if (formType !== 'cli' && !formApiKey.trim()) {
			alert('กรุณากรอก API Key');
			return;
		}

		isSaving = true;
		try {
			const modelObj: AIModelConfig = {
				id: formId || formName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
				name: formName,
				badge: formBadge || formName,
				type: formType,
				endpoint: formEndpoint,
				apiKey: formApiKey,
				modelId: formModelId,
				color: formColor,
				active: true,
				inConsensus: formInConsensus,
				isBuiltin: false
			};

			const res = await fetch('/api/models', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'save', model: modelObj })
			});
			if (res.ok) {
				isAdding = false;
				onModelsUpdated();
			} else {
				const d = await res.json();
				alert(d.error || 'Failed to save model');
			}
		} catch (e: any) {
			alert(e.message);
		} finally {
			isSaving = false;
		}
	}

	async function toggleModelActive(m: AIModelConfig) {
		const updated = { ...m, active: !m.active };
		await fetch('/api/models', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'save', model: updated })
		});
		onModelsUpdated();
	}

	async function toggleModelConsensus(m: AIModelConfig) {
		const updated = { ...m, inConsensus: !m.inConsensus };
		await fetch('/api/models', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'save', model: updated })
		});
		onModelsUpdated();
	}

	async function deleteModel(id: string) {
		if (!confirm('ยืนยันที่จะลบโมเดลนี้?')) return;
		await fetch('/api/models', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'delete', model: { id } })
		});
		onModelsUpdated();
	}
</script>

{#if isOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs font-sans">
		<div class="w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-950 p-6 flex flex-col gap-5 shadow-2xl max-h-[90vh] overflow-y-auto">
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-zinc-800/80 pb-4">
				<div class="flex items-center gap-2.5">
					<div class="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
						<Cpu class="w-4 h-4" />
					</div>
					<div>
						<h3 class="text-sm font-semibold text-zinc-100 flex items-center gap-2">
							<span>AI Models & API Settings</span>
							<span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 font-normal">
								{models.length} registered
							</span>
						</h3>
						<p class="text-xs text-zinc-400">เพิ่ม แก้ไข หรือเชื่อมต่อ Claude, OpenAI, Gemini เข้าระบบและ Consensus Loop</p>
					</div>
				</div>
				<button 
					onclick={onClose}
					class="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition cursor-pointer"
				>
					<X class="w-4 h-4" />
				</button>
			</div>

			<!-- Models List -->
			<div class="flex flex-col gap-2.5">
				<div class="flex items-center justify-between text-xs">
					<span class="font-medium text-zinc-300">โมเดลที่ติดตั้งแล้ว</span>
					{#if !isAdding}
						<button 
							onclick={startAddNew}
							class="text-xs px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-zinc-950 font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
						>
							<Plus class="w-3.5 h-3.5" />
							<span>+ เพิ่มโมเดลใหม่ (Claude / Gemini / etc.)</span>
						</button>
					{/if}
				</div>

				<div class="flex flex-col gap-2">
					{#each models as m}
						<div class="p-3 rounded-lg border border-zinc-800/80 bg-zinc-900/40 flex items-center justify-between gap-3 text-xs">
							<div class="flex items-center gap-3 min-w-0">
								<span class="px-2 py-0.5 rounded text-[10px] font-mono font-medium border {m.color === 'orange' ? 'bg-orange-950/60 text-orange-300 border-orange-800/60' : m.color === 'violet' ? 'bg-violet-950/60 text-violet-300 border-violet-800/60' : m.color === 'blue' ? 'bg-blue-950/60 text-blue-300 border-blue-800/60' : 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'}">
									{m.badge || m.id}
								</span>
								<div class="flex flex-col min-w-0">
									<div class="font-medium text-zinc-200 truncate flex items-center gap-2">
										<span>{m.name}</span>
										{#if m.isBuiltin}
											<span class="text-[9px] px-1 rounded bg-zinc-800 text-zinc-500 font-mono">Built-in</span>
										{/if}
									</div>
									<div class="text-[11px] text-zinc-500 font-mono truncate">
										Type: {m.type} {m.modelId ? `(${m.modelId})` : ''} {m.apiKey ? `• Key: ${m.apiKey}` : ''}
									</div>
								</div>
							</div>

							<!-- Controls -->
							<div class="flex items-center gap-3 shrink-0">
								<label class="flex items-center gap-1.5 cursor-pointer" title="เปิด/ปิด การใช้งานโมเดลนี้">
									<input 
										type="checkbox" 
										checked={m.active} 
										onchange={() => toggleModelActive(m)}
										class="rounded bg-zinc-800 border-zinc-700 text-amber-500 focus:ring-0 cursor-pointer"
									/>
									<span class="text-[11px] text-zinc-400">ใช้งาน</span>
								</label>

								<label class="flex items-center gap-1.5 cursor-pointer" title="ดึงโมเดลนี้มาร่วมใน Consensus Loop">
									<input 
										type="checkbox" 
										checked={m.inConsensus} 
										onchange={() => toggleModelConsensus(m)}
										class="rounded bg-zinc-800 border-zinc-700 text-amber-500 focus:ring-0 cursor-pointer"
									/>
									<span class="text-[11px] text-amber-300/80 font-medium">Consensus</span>
								</label>

								{#if !m.isBuiltin}
									<button 
										onclick={() => deleteModel(m.id)}
										title="ลบโมเดลนี้"
										class="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-red-950/40 transition cursor-pointer"
									>
										<Trash2 class="w-3.5 h-3.5" />
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>

			<!-- Add Model Form (Drawer) -->
			{#if isAdding}
				<div class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 flex flex-col gap-3.5 mt-2">
					<div class="flex items-center justify-between">
						<span class="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
							<Sparkles class="w-3.5 h-3.5" />
							<span>ฟอร์มเพิ่มโมเดลใหม่</span>
						</span>
						<button 
							onclick={() => (isAdding = false)}
							class="text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
						>
							ยกเลิก
						</button>
					</div>

					<!-- Presets Dropdown -->
					<div class="flex flex-col gap-1 text-xs">
						<label for="preset-select" class="text-zinc-400 font-medium">เลือกรูปแบบสำเร็จรูป (Presets):</label>
						<select 
							id="preset-select"
							value={selectedPreset}
							onchange={(e) => applyPreset(e.currentTarget.value)}
							class="w-full bg-zinc-900 border border-zinc-700 rounded-md px-3 py-1.5 text-zinc-100 text-xs focus:outline-hidden focus:border-amber-500"
						>
							{#each PRESETS as p}
								<option value={p.label}>{p.label}</option>
							{/each}
						</select>
					</div>

					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
						<div class="flex flex-col gap-1">
							<label for="form-model-name" class="text-zinc-400 font-medium">ชื่อโมเดล (Display Name):</label>
							<input 
								id="form-model-name"
								type="text" 
								bind:value={formName} 
								class="bg-zinc-900 border border-zinc-700 rounded-md px-3 py-1.5 text-zinc-100 font-sans focus:outline-hidden focus:border-amber-500"
							/>
						</div>
						<div class="flex flex-col gap-1">
							<label for="form-model-badge" class="text-zinc-400 font-medium">ป้ายปุ่ม (Button Badge):</label>
							<input 
								id="form-model-badge"
								type="text" 
								bind:value={formBadge} 
								class="bg-zinc-900 border border-zinc-700 rounded-md px-3 py-1.5 text-zinc-100 font-mono focus:outline-hidden focus:border-amber-500"
							/>
						</div>
						<div class="flex flex-col gap-1">
							<label for="form-model-id" class="text-zinc-400 font-medium">Model ID:</label>
							<input 
								id="form-model-id"
								type="text" 
								bind:value={formModelId} 
								class="bg-zinc-900 border border-zinc-700 rounded-md px-3 py-1.5 text-zinc-100 font-mono focus:outline-hidden focus:border-amber-500"
							/>
						</div>
						<div class="flex flex-col gap-1">
							<label for="form-model-endpoint" class="text-zinc-400 font-medium">API Endpoint URL:</label>
							<input 
								id="form-model-endpoint"
								type="text" 
								bind:value={formEndpoint} 
								class="bg-zinc-900 border border-zinc-700 rounded-md px-3 py-1.5 text-zinc-100 font-mono text-[11px] focus:outline-hidden focus:border-amber-500"
							/>
						</div>
					</div>

					<!-- API Key Input -->
					<div class="flex flex-col gap-1 text-xs">
						<label for="form-model-key" class="text-zinc-400 font-medium flex items-center justify-between">
							<span class="flex items-center gap-1.5">
								<Key class="w-3 h-3 text-amber-400" />
								<span>API Key / Secret Token:</span>
							</span>
							<span class="text-[10px] text-zinc-500">เก็บปลอดภัยในเซิร์ฟเวอร์</span>
						</label>
						<input 
							id="form-model-key"
							type="password" 
							bind:value={formApiKey} 
							placeholder="sk-ant-api03-... หรือ sk-..."
							class="w-full bg-zinc-900 border border-zinc-700 rounded-md px-3 py-1.5 text-zinc-100 font-mono focus:outline-hidden focus:border-amber-500"
						/>
					</div>

					<!-- Test Feedback -->
					{#if testResult}
						<div class="p-2.5 rounded-md text-xs flex items-center gap-2 {testResult.success ? 'bg-emerald-950/60 border border-emerald-800/80 text-emerald-300' : 'bg-red-950/60 border border-red-800/80 text-red-300'}">
							{#if testResult.success}
								<Check class="w-4 h-4 shrink-0 text-emerald-400" />
							{:else}
								<AlertCircle class="w-4 h-4 shrink-0 text-red-400" />
							{/if}
							<span class="truncate">{testResult.message}</span>
						</div>
					{/if}

					<!-- Actions -->
					<div class="flex items-center justify-end gap-2 pt-1 border-t border-zinc-800/60">
						<button 
							type="button"
							onclick={testConnection}
							disabled={isTesting || !formApiKey.trim()}
							class="px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 text-xs font-medium transition flex items-center gap-1.5 cursor-pointer"
						>
							<RefreshCw class="w-3 h-3 {isTesting ? 'animate-spin' : ''}" />
							<span>{isTesting ? 'กำลังทดสอบ...' : 'ทดสอบการเชื่อมต่อ (Test)'}</span>
						</button>
						<button 
							type="button"
							onclick={saveModel}
							disabled={isSaving}
							class="px-4 py-1.5 rounded-md bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs transition flex items-center gap-1.5 cursor-pointer shadow-xs"
						>
							<Check class="w-3.5 h-3.5" />
							<span>{isSaving ? 'กำลังบันทึก...' : 'บันทึกโมเดล (Save)'}</span>
						</button>
					</div>
				</div>
			{/if}

			<!-- Footer Note -->
			<div class="border-t border-zinc-800/80 pt-3 flex items-center justify-between text-[11px] text-zinc-500">
				<span>ทุกโมเดลที่บันทึกไว้จะแสดงบนปุ่มเลือกคำสั่ง และสามารถร่วมวง Consensus Loop ได้ทันที</span>
				<button 
					onclick={onClose}
					class="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition cursor-pointer"
				>
					ปิดหน้าต่าง
				</button>
			</div>
		</div>
	</div>
{/if}
