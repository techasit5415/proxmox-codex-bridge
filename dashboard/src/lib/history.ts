import fs from 'fs';
import path from 'path';

export interface TaskRecord {
	id: string;
	timestamp: number;
	date: string;
	workspace: string;
	provider: string;
	prompt: string;
	branch: string;
	status: string;
	diff: string;
	logs: string;
	tokens: {
		total_tokens: number;
		input_tokens: number;
		cached_input_tokens: number;
		output_tokens: number;
	};
	mode?: 'single' | 'both';
	codex?: any;
	deepseek?: any;
}

const HISTORY_FILE = '/opt/agent-bridge/tasks_history.json';
const SESSIONS_BASE = '/root/.codex/sessions';

function getCodexSessionFiles(dir: string): string[] {
	let files: string[] = [];
	try {
		if (!fs.existsSync(dir)) return files;
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				files = files.concat(getCodexSessionFiles(full));
			} else if (entry.name.endsWith('.jsonl')) {
				files.push(full);
			}
		}
	} catch (e) {}
	return files;
}

export function loadExistingHistory(): TaskRecord[] {
	try {
		if (fs.existsSync(HISTORY_FILE)) {
			const data = fs.readFileSync(HISTORY_FILE, 'utf8');
			return JSON.parse(data);
		}
	} catch (e) {
		console.error('Error reading history file:', e);
	}
	return [];
}

export function saveHistory(records: TaskRecord[]) {
	try {
		fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
		fs.writeFileSync(HISTORY_FILE, JSON.stringify(records, null, 2), 'utf8');
	} catch (e) {
		console.error('Error saving history file:', e);
	}
}

export function saveTaskToHistory(task: Omit<TaskRecord, 'id' | 'timestamp' | 'date'> & { id?: string; timestamp?: number; date?: string }): TaskRecord {
	const history = loadExistingHistory();
	const now = Date.now();
	const record: TaskRecord = {
		id: task.id || `task_${now}_${Math.random().toString(36).substring(2, 7)}`,
		timestamp: task.timestamp || now,
		date: task.date || new Date(now).toISOString(),
		workspace: task.workspace || 'Android-Tv',
		provider: task.provider || 'Codex (gpt-6.1-sol)',
		prompt: task.prompt || '',
		branch: task.branch || 'main',
		status: task.status || 'Clean',
		diff: task.diff || '',
		logs: task.logs || '',
		tokens: task.tokens || { total_tokens: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
		mode: task.mode || 'single',
		codex: task.codex,
		deepseek: task.deepseek
	};

	// Prepend new record
	history.unshift(record);

	// Limit to last 50 tasks
	if (history.length > 50) {
		history.length = 50;
	}

	saveHistory(history);
	return record;
}

export function scanAndSyncCodexSessions(): TaskRecord[] {
	let history = loadExistingHistory();
	const existingIds = new Set(history.map((h) => h.id));

	const sessionFiles = getCodexSessionFiles(SESSIONS_BASE);
	sessionFiles.sort((a, b) => {
		try {
			return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
		} catch {
			return 0;
		}
	});

	let addedCount = 0;

	for (const file of sessionFiles) {
		const basename = path.basename(file, '.jsonl');
		const fileId = `codex_${basename}`;
		
		const existingIndex = history.findIndex((h) => h.id === fileId);
		if (existingIndex !== -1) {
			const existing = history[existingIndex];
			// Only skip if already has meaningful prompt AND logs!
			const isDummy = 
				!existing.prompt ||
				existing.prompt.startsWith('Session ') ||
				!existing.logs ||
				existing.logs.startsWith('Session file:');
			if (!isDummy) {
				continue;
			}
		}

		try {
			const stat = fs.statSync(file);
			const lines = fs.readFileSync(file, 'utf8').split('\n');

			let cwd = '/opt/agent-bridge/workspaces/Android-Tv';
			let prompt = '';
			let reply = '';
			let tokens = { total_tokens: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
			const thoughtLines: string[] = [];
			let fileTimestamp = stat.mtimeMs;

			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const obj = JSON.parse(line);
					if (obj.timestamp) {
						const ts = new Date(obj.timestamp).getTime();
						if (!isNaN(ts)) fileTimestamp = ts;
					}

					if (obj.type === 'session_meta' && obj.payload?.cwd) {
						cwd = obj.payload.cwd;
					}

					if (
						obj.type === 'event_msg' &&
						obj.payload?.type === 'item_completed' &&
						obj.payload?.item?.type === 'UserMessage'
					) {
						const contents = obj.payload.item.content || [];
						prompt = contents.map((c: any) => c.text || '').join(' ').trim();
					}

					if (
						obj.type === 'event_msg' &&
						obj.payload?.type === 'item_completed' &&
						obj.payload?.item?.type === 'AgentMessage'
					) {
						const contents = obj.payload.item.content || [];
						const txt = contents.map((c: any) => c.text || '').join(' ').trim();
						if (txt) thoughtLines.push(txt);
					}

					if (obj.type === 'event_msg' && obj.payload?.type === 'task_complete') {
						reply = obj.payload.last_agent_message || '';
					}

					if (obj.payload?.info?.total_token_usage) {
						tokens = obj.payload.info.total_token_usage;
					} else if (obj.payload?.usage) {
						tokens = obj.payload.usage;
					}
				} catch (e) {}
			}

			// If no prompt found, default to basename
			if (!prompt) {
				prompt = `Session ${basename.substring(0, 19)}`;
			}

			const wsName = path.basename(cwd) || 'Android-Tv';
			
			// If reply exists, it is the primary model response!
			let logsText = '';
			if (reply) {
				logsText = thoughtLines.length > 0
					? `${thoughtLines.join('\n\n')}\n\n${reply}`
					: reply;
			} else if (thoughtLines.length > 0) {
				logsText = thoughtLines.join('\n\n');
			} else {
				logsText = `Session file: ${path.basename(file)}`;
			}

			const record: TaskRecord = {
				id: fileId,
				timestamp: fileTimestamp,
				date: new Date(fileTimestamp).toISOString(),
				workspace: wsName,
				provider: 'Codex (gpt-6.1-sol)',
				prompt: prompt,
				branch: 'main',
				status: reply ? 'Completed' : 'Archived session',
				diff: reply ? `// Last Agent Response:\n${reply}` : '(No diff recorded for past CLI session)',
				logs: logsText,
				tokens: tokens,
				mode: 'single'
			};

			if (existingIndex !== -1) {
				history[existingIndex] = record;
			} else {
				history.push(record);
			}
			addedCount++;
		} catch (e) {
			console.error(`Error parsing session file ${file}:`, e);
		}
	}

	if (addedCount > 0) {
		history.sort((a, b) => b.timestamp - a.timestamp);
		if (history.length > 50) history.length = 50;
		saveHistory(history);
	}

	return history.sort((a, b) => b.timestamp - a.timestamp);
}
