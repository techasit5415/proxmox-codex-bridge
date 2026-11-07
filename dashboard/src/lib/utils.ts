import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { TokenUsage, TaskContentType } from './types';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function fmtTokens(n: number | undefined | null): string {
	if (n === undefined || n === null) return '0';
	return n.toLocaleString();
}

export function getNetTokens(t?: TokenUsage | null): number {
	if (!t) return 0;
	if (typeof t.net_tokens === 'number' && t.net_tokens > 0) return t.net_tokens;
	const total = t.total_tokens || 0;
	const cached = t.cached_input_tokens || 0;
	return Math.max(0, total - cached);
}

export function fmtTokenBadge(t?: TokenUsage | null): string {
	if (!t || !t.total_tokens) return '0 tok';
	const net = getNetTokens(t);
	const cached = t.cached_input_tokens || 0;
	if (cached > 0) {
		const pct = Math.round((cached / t.total_tokens) * 100);
		return `${net.toLocaleString()} net (${t.total_tokens.toLocaleString()} tot · ${pct}% cached)`;
	}
	return `${net.toLocaleString()} tok`;
}

export function slugifyPrompt(prompt: string): string {
	const clean = (prompt || '')
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 35);
	const id = Math.random().toString(36).substring(2, 6);
	return `temp-${clean || 'scratch'}-${id}`;
}

export function detectTaskType(prompt: string): TaskContentType {
	if (!prompt) return 'general';
	const lower = prompt.toLowerCase();

	// Explicit code-editing / file-creation imperatives
	const codeEditKeywords = [
		'แก้โค้ด', 'แก้บั๊ก', 'สร้างไฟล์', 'ลบไฟล์', 'แก้ไขไฟล์', 'เขียนโค้ด',
		'เพิ่มฟังก์ชัน', 'เขียนโปรแกรม', 'สร้างคอมโพเนนต์', 'รันสคริปต์',
		'fix bug', 'refactor', 'implement', 'write code', 'create file', 'modify file'
	];

	// Analysis / explanation / consultation keywords
	const analysisKeywords = [
		'อธิบาย', 'วิเคราะห์', 'สรุป', 'ภาพรวม', 'ภาพใหญ่', 'ข้อดี', 'ข้อเสีย',
		'การทำงานของ', 'ทำงานยังไง', 'คืออะไร', 'ทำไม', 'อย่างไร', 'เปรียบเทียบ',
		'ความเห็น', 'แนะนำ', 'ประเมิน', 'เที่ยว', 'แพลน', 'วางแผน',
		'explain', 'analyze', 'summarize', 'overview', 'architecture', 'pros and cons',
		'how does', 'what is', 'why', 'compare', 'review', 'opinion', 'recommend'
	];

	let hasEditIntent = false;
	for (const kw of codeEditKeywords) {
		if (lower.includes(kw)) {
			hasEditIntent = true;
			break;
		}
	}

	let analysisScore = 0;
	for (const kw of analysisKeywords) {
		if (lower.includes(kw)) analysisScore++;
	}

	if (analysisScore > 0 && !hasEditIntent) {
		return 'general';
	}

	const codeKeywords = [
		'code', 'function', 'class', 'bug', 'fix', 'refactor', 'test',
		'component', 'api', 'endpoint', 'npm', 'pip', 'python', 'javascript',
		'typescript', 'svelte', 'react', 'css', 'html', 'git', 'repo',
		'docker', 'database', 'sql', 'script', 'compile', 'build', 'import'
	];

	let codeScore = hasEditIntent ? 3 : 0;
	for (const kw of codeKeywords) {
		if (lower.includes(kw)) codeScore++;
	}

	if (analysisScore > codeScore) return 'general';
	if (codeScore > analysisScore) return 'code';

	if (/[{}<>;`$]/.test(prompt) || /\b(src|app|lib|test|index|package)\b/i.test(prompt)) {
		return 'code';
	}

	return codeScore > 0 ? 'code' : 'general';
}

export function extractThoughtAndBody(raw: string): { thoughts: string; body: string } {
	if (!raw) return { thoughts: '', body: '' };

	// 1. Check for <think>...</think> (DeepSeek R1 or pre-wrapped thoughts)
	const thinkMatch = raw.match(/<think>([\s\S]*?)<\/think>/i);
	if (thinkMatch) {
		const cleanedBody = raw.replace(/<think>[\s\S]*?<\/think>/i, '').trim();
		// If the remaining body STILL contains a raw OpenAI Codex stderr dump, recursively clean it
		if (cleanedBody.includes('OpenAI Codex v')) {
			const nested = extractThoughtAndBody(cleanedBody);
			return {
				thoughts: [thinkMatch[1].trim(), nested.thoughts].filter(Boolean).join('\n\n'),
				body: nested.body
			};
		}
		return {
			thoughts: thinkMatch[1].trim(),
			body: cleanedBody
		};
	}

	// 2. Check for OpenAI Codex CLI session transcript ("OpenAI Codex v...")
	const codexHeaderIdx = raw.indexOf('OpenAI Codex v');
	if (codexHeaderIdx !== -1) {
		const stdoutPart = raw.slice(0, codexHeaderIdx).trim();
		const stderrPart = raw.slice(codexHeaderIdx).trim();

		// Extract clean final answer: prefer stdoutPart; if empty, extract after the last "\ncodex\n" in stderrPart
		let cleanBody = stdoutPart;
		const lastCodexMarker = stderrPart.lastIndexOf('\ncodex\n');
		if (!cleanBody && lastCodexMarker !== -1) {
			cleanBody = stderrPart
				.slice(lastCodexMarker + '\ncodex\n'.length)
				.replace(/\r?\ntokens used\r?\n[\d,.\s]+$/i, '')
				.trim();
		}
		cleanBody = cleanBody.replace(/\r?\ntokens used\r?\n[\d,.\s]+$/i, '').trim();

		let traceSection = lastCodexMarker !== -1 ? stderrPart.slice(0, lastCodexMarker) : stderrPart;
		traceSection = traceSection.replace(/\nuser\r?\n[\s\S]*?(?=(\n(?:codex|exec)\r?\n|$))/i, '');

		return {
			thoughts: traceSection.trim(),
			body: cleanBody || raw
		};
	}

	return { thoughts: '', body: raw.replace(/\r?\ntokens used\r?\n[\d,.\s]+$/i, '').trim() };
}
