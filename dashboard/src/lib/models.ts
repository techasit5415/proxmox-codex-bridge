import fs from 'fs';
import path from 'path';
import type { AIModelConfig } from './types';

const MODELS_FILE = fs.existsSync('/opt/agent-bridge') 
	? '/opt/agent-bridge/models.json'
	: path.resolve('models.json');

export const DEFAULT_MODELS: AIModelConfig[] = [
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
		apiKey: process.env.KMITL_TOKEN || '',
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
