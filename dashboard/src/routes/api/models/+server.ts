import { json } from '@sveltejs/kit';
import fs from 'fs';
import path from 'path';
import type { RequestHandler } from './$types';
import type { AIModelConfig } from '$lib/types';

const MODELS_FILE = fs.existsSync('/opt/agent-bridge') 
	? '/opt/agent-bridge/models.json'
	: path.resolve('models.json');

const DEFAULT_MODELS: AIModelConfig[] = [
	{
		id: 'codex',
		name: 'OpenAI Codex (ChatGPT)',
		type: 'cli',
		badge: 'Codex (ChatGPT)',
		color: 'emerald',
		active: true,
		inConsensus: true,
		isBuiltin: true
	},
	{
		id: 'deepseek',
		name: 'DeepSeek R1 (14b GPU)',
		type: 'ollama',
		endpoint: 'https://aipass.cskmitl.com/api/chat',
		apiKey: 'gpu_910c7fbfed984909803659c2885e0d320746a068',
		modelId: 'deepseek-r1:14b',
		badge: 'DeepSeek R1',
		color: 'violet',
		active: true,
		inConsensus: true,
		isBuiltin: true
	}
];

export function getModels(): AIModelConfig[] {
	try {
		if (fs.existsSync(MODELS_FILE)) {
			const content = fs.readFileSync(MODELS_FILE, 'utf8');
			return JSON.parse(content);
		}
	} catch (e) {
		console.error('Failed to read models.json:', e);
	}
	saveModels(DEFAULT_MODELS);
	return DEFAULT_MODELS;
}

export function saveModels(models: AIModelConfig[]) {
	try {
		fs.writeFileSync(MODELS_FILE, JSON.stringify(models, null, 2), 'utf8');
	} catch (e) {
		console.error('Failed to save models.json:', e);
	}
}

export const GET: RequestHandler = async () => {
	const models = getModels();
	// Mask API keys for security in client view
	const safeModels = models.map(m => ({
		...m,
		apiKey: m.apiKey ? (m.apiKey.length > 8 ? `${m.apiKey.slice(0, 3)}...${m.apiKey.slice(-4)}` : '••••••••') : ''
	}));
	return json({ models: safeModels });
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { action, model } = body;

		if (action === 'test') {
			// Test model connection
			if (model.type === 'anthropic') {
				const apiKey = model.apiKey?.includes('...') 
					? getModels().find(m => m.id === model.id)?.apiKey 
					: model.apiKey;
				
				if (!apiKey) return json({ success: false, error: 'API Key is required' });

				const res = await fetch('https://api.anthropic.com/v1/messages', {
					method: 'POST',
					headers: {
						'x-api-key': apiKey,
						'anthropic-version': '2023-06-01',
						'content-type': 'application/json'
					},
					body: JSON.stringify({
						model: model.modelId || 'claude-3-5-sonnet-20241022',
						max_tokens: 15,
						messages: [{ role: 'user', content: 'Hi' }]
					})
				});

				if (!res.ok) {
					const errText = await res.text().catch(() => '');
					return json({ success: false, error: `Anthropic Error (${res.status}): ${errText}` });
				}
				const data = await res.json();
				return json({ success: true, message: `Connected! Response: "${data.content?.[0]?.text?.trim()}"` });
			} 
			
			if (model.type === 'openai-compatible') {
				const apiKey = model.apiKey?.includes('...') 
					? getModels().find(m => m.id === model.id)?.apiKey 
					: model.apiKey;
				const endpoint = model.endpoint || 'https://api.openai.com/v1/chat/completions';

				const res = await fetch(endpoint, {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${apiKey}`,
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						model: model.modelId || 'gpt-4o',
						messages: [{ role: 'user', content: 'Hi' }],
						max_tokens: 15
					})
				});

				if (!res.ok) {
					const errText = await res.text().catch(() => '');
					return json({ success: false, error: `API Error (${res.status}): ${errText}` });
				}
				const data = await res.json();
				return json({ success: true, message: `Connected! Response: "${data.choices?.[0]?.message?.content?.trim()}"` });
			}

			if (model.type === 'ollama') {
				const endpoint = model.endpoint || 'http://localhost:11434/api/chat';
				const headers: Record<string, string> = { 'Content-Type': 'application/json' };
				if (model.apiKey) headers['Authorization'] = `Bearer ${model.apiKey}`;

				const res = await fetch(endpoint, {
					method: 'POST',
					headers,
					body: JSON.stringify({
						model: model.modelId,
						messages: [{ role: 'user', content: 'Hi' }],
						stream: false
					})
				});

				if (!res.ok) {
					const errText = await res.text().catch(() => '');
					return json({ success: false, error: `Ollama Error (${res.status}): ${errText}` });
				}
				return json({ success: true, message: 'Connected to Ollama endpoint successfully!' });
			}

			return json({ success: true, message: 'CLI model ready' });
		}

		if (action === 'save') {
			const models = getModels();
			const existingIndex = models.findIndex(m => m.id === model.id);
			
			// Retain existing key if masked
			let finalApiKey = model.apiKey;
			if (existingIndex >= 0 && model.apiKey?.includes('...')) {
				finalApiKey = models[existingIndex].apiKey;
			}

			const updatedModel: AIModelConfig = {
				...model,
				apiKey: finalApiKey
			};

			if (existingIndex >= 0) {
				models[existingIndex] = updatedModel;
			} else {
				models.push(updatedModel);
			}

			saveModels(models);
			return json({ success: true, models });
		}

		if (action === 'delete') {
			let models = getModels();
			models = models.filter(m => m.id !== model.id || m.isBuiltin);
			saveModels(models);
			return json({ success: true, models });
		}

		return json({ success: false, error: 'Unknown action' }, { status: 400 });
	} catch (err: any) {
		console.error('Error in /api/models:', err);
		return json({ success: false, error: err.message }, { status: 500 });
	}
};
