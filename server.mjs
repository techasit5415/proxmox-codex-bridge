import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = util.promisify(exec);
const WORKSPACES_DIR = '/opt/agent-bridge/workspaces';
const KMITL_API_URL = 'https://aipass.cskmitl.com/api/chat';
const KMITL_TOKEN = process.env.KMITL_TOKEN || '';
const DEEPSEEK_MODEL = 'deepseek-r1:14b';
const HISTORY_FILE = '/opt/agent-bridge/tasks_history.json';

function getLatestTokenUsage() {
  const baseDir = '/root/.codex/sessions';
  if (!fs.existsSync(baseDir)) return null;

  function getFiles(dir) {
    let files = [];
    try {
      fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) files = files.concat(getFiles(fullPath));
        else if (entry.name.endsWith('.jsonl')) files.push(fullPath);
      });
    } catch (e) {}
    return files;
  }

  const allFiles = getFiles(baseDir);
  if (allFiles.length === 0) return null;
  allFiles.sort((a, b) => {
    try {
      return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  });
  const latestFile = allFiles[0];

  try {
    const lines = fs.readFileSync(latestFile, 'utf8').split('\n');
    let lastUsage = null;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        const payload = parsed.payload;
        if (payload?.info?.total_token_usage) lastUsage = payload.info.total_token_usage;
        else if (payload?.token_usage) lastUsage = payload.token_usage;
      } catch (e) {}
    }
    return lastUsage;
  } catch (e) {
    return null;
  }
}

function recordTaskHistory(entry) {
  try {
    let history = [];
    if (fs.existsSync(HISTORY_FILE)) {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
    const now = Date.now();
    history.unshift({
      id: `task_${now}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: now,
      date: new Date(now).toISOString(),
      source: 'Antigravity MCP',
      ...entry
    });
    if (history.length > 50) history.length = 50;
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to record task history:', e);
  }
}

const server = new Server(
  { name: 'proxmox-agent-bridge', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'list_workspaces',
        description: 'แสดงรายชื่อ repositories/workspaces ทั้งหมดบน Proxmox CT',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'inspect_workspace',
        description: 'ตรวจสอบ Git branch, status, และโครงสร้างไฟล์ของโปรเจกต์',
        inputSchema: {
          type: 'object',
          properties: {
            workspace: { type: 'string', description: 'ชื่อโฟลเดอร์ใน workspaces' }
          },
          required: ['workspace']
        }
      },
      {
        name: 'clone_repo',
        description: 'โคลน Git repository จาก Git URL เข้าสู่ /opt/agent-bridge/workspaces',
        inputSchema: {
          type: 'object',
          properties: {
            repoUrl: { type: 'string', description: 'Git clone URL เช่น https://github.com/user/repo.git' },
            folderName: { type: 'string', description: 'ชื่อโฟลเดอร์ปลายทาง (เว้นว่างได้)' }
          },
          required: ['repoUrl']
        }
      },
      {
        name: 'delete_workspace',
        description: 'ลบ workspace หรือ temp workspace ออกจาก /opt/agent-bridge/workspaces',
        inputSchema: {
          type: 'object',
          properties: {
            workspace: { type: 'string', description: 'ชื่อโฟลเดอร์ใน workspaces ที่ต้องการลบ' }
          },
          required: ['workspace']
        }
      },
      {
        name: 'run_codex_task',
        description: 'สั่งให้ OpenAI Codex CLI (ChatGPT Plus: gpt-6.1-sol) แก้ไขโค้ดใน workspace แบบอัตโนมัติ',
        inputSchema: {
          type: 'object',
          properties: {
            workspace: { type: 'string', description: 'ชื่อโฟลเดอร์โปรเจกต์' },
            prompt: { type: 'string', description: 'คำสั่งงานเขียนโค้ดสำหรับ Codex' },
            branch: { type: 'string', description: 'ชื่อ branch ใหม่ (ถ้าไม่ระบุจะสร้างให้อัตโนมัติ)' }
          },
          required: ['workspace', 'prompt']
        }
      },
      {
        name: 'run_deepseek_task',
        description: 'สั่งให้ DeepSeek R1 (14b KMITL GPU) แก้ไขโค้ดใน workspace แบบอัตโนมัติ',
        inputSchema: {
          type: 'object',
          properties: {
            workspace: { type: 'string', description: 'ชื่อโฟลเดอร์โปรเจกต์' },
            prompt: { type: 'string', description: 'คำสั่งงานเขียนโค้ดสำหรับ DeepSeek R1' },
            branch: { type: 'string', description: 'ชื่อ branch ใหม่' }
          },
          required: ['workspace', 'prompt']
        }
      },
      {
        name: 'run_dual_task',
        description: 'สั่งทั้ง Codex (gpt-6.1-sol) และ DeepSeek R1 (14b GPU) ทำงานพร้อมกันบนคนละ branch (แยก Git Worktrees อิสระ)',
        inputSchema: {
          type: 'object',
          properties: {
            workspace: { type: 'string', description: 'ชื่อโฟลเดอร์โปรเจกต์' },
            prompt: { type: 'string', description: 'คำสั่งงาน' }
          },
          required: ['workspace', 'prompt']
        }
      },
      {
        name: 'run_consensus_task',
        description: 'รัน Multi-Agent Consensus Loop (Codex + DeepSeek ทำ Peer Review ข้ามกันและกลั่นกรองสรุปเป็น Master Solution)',
        inputSchema: {
          type: 'object',
          properties: {
            workspace: { type: 'string', description: 'ชื่อโฟลเดอร์โปรเจกต์ หรือ temp' },
            prompt: { type: 'string', description: 'คำสั่งงานที่ต้องการให้ทั้ง 2 Agent ร่วมกันวิเคราะห์และสร้างโค้ด' }
          },
          required: ['workspace', 'prompt']
        }
      },
      {
        name: 'run_command',
        description: 'รันคำสั่ง bash ใน workspace ที่ระบุ (เช่น npm test, git diff, ls -la)',
        inputSchema: {
          type: 'object',
          properties: {
            workspace: { type: 'string', description: 'ชื่อโฟลเดอร์ใน workspaces' },
            command: { type: 'string', description: 'คำสั่ง bash ที่ต้องการรัน' }
          },
          required: ['workspace', 'command']
        }
      }
    ]
  };
});

function sanitizeForApi(text, maxChars = 4000) {
  if (!text) return '';
  let clean = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
                  .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '');
  if (clean.length > maxChars) {
    clean = clean.slice(0, maxChars) + '\n...[truncated for token limit]';
  }
  return clean;
}

async function prepareWorktree(repoDir, branchName, prefix) {
  try {
    await execAsync('git rev-parse HEAD', { cwd: repoDir });
  } catch (e) {
    await execAsync('git init && git add -A && git commit -m "init workspace" --allow-empty', { cwd: repoDir });
  }

  const { stdout: headOut } = await execAsync('git rev-parse HEAD', { cwd: repoDir });
  const baseCommit = headOut.trim();

  const excludeFile = path.join(repoDir, '.git', 'info', 'exclude');
  try {
    let excl = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : '';
    if (!excl.includes('.worktrees')) {
      fs.appendFileSync(excludeFile, '\n.worktrees\n.worktrees/**\n');
    }
  } catch (e) {}

  const worktreesBase = path.join(repoDir, '.worktrees');
  if (!fs.existsSync(worktreesBase)) {
    fs.mkdirSync(worktreesBase, { recursive: true });
  }

  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 6);
  const worktreePath = path.join(worktreesBase, `${prefix}-${ts}-${rand}`);

  await execAsync(`git worktree add -B "${branchName}" "${worktreePath}" ${baseCommit}`, { cwd: repoDir });

  return { worktreePath, branchName, baseCommit };
}

async function cleanupWorktree(repoDir, ctx, commitMsg) {
  try {
    if (commitMsg && fs.existsSync(ctx.worktreePath)) {
      try {
        await execAsync(`git add -A && git commit -m "${commitMsg.replace(/"/g, '\\"')}" --allow-empty`, { cwd: ctx.worktreePath });
      } catch (e) {}
    }
  } catch (e) {}

  try {
    await execAsync(`git worktree remove --force "${ctx.worktreePath}"`, { cwd: repoDir });
  } catch (e) {
    try {
      if (fs.existsSync(ctx.worktreePath)) {
        fs.rmSync(ctx.worktreePath, { recursive: true, force: true });
      }
    } catch (err) {}
  }

  try {
    await execAsync('git worktree prune', { cwd: repoDir });
  } catch (e) {}
}

async function executeDeepSeek(target, prompt, branchName, cwdOverride) {
  const runDir = cwdOverride || target;
  if (!cwdOverride) {
    try {
      await execAsync(`git checkout -b ${branchName}`, { cwd: target });
    } catch (e) {}
  }

  const taskType = detectTaskType(prompt);
  let fileList = '';
  try {
    const { stdout } = await execAsync('git ls-files | head -n 40', { cwd: runDir });
    fileList = stdout;
  } catch (e) {}

  const systemPrompt = taskType === 'general'
    ? `You are an expert AI advisor and assistant. The user is asking a general planning, advisory, or analytical question.
Provide a clear, detailed, well-structured, and comprehensive response in the requested language (e.g. Thai).
Do NOT format your response as code files or file: blocks unless specifically requested.`
    : `You are an expert software engineer. Given a user task and workspace files, generate the necessary code changes.
Format your response using this syntax:

file:path/to/file.ext
\`\`\`language
<complete file content here>
\`\`\`
`;

  const userContent = taskType === 'general'
    ? prompt
    : `Workspace files:\n${fileList}\n\nTask:\n${prompt}`;

  const res = await fetch(KMITL_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KMITL_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      stream: true
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`KMITL API Error (${res.status}): ${errText}`);
  }

  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let thinking = '';
  let reply = '';
  let promptTokens = 35;
  let completionTokens = 0;
  let cachedTokens = 0;

  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          if (json.message?.thinking) thinking += json.message.thinking;
          if (json.message?.content) reply += json.message.content;
          if (json.prompt_eval_count) promptTokens = json.prompt_eval_count;
          if (json.eval_count) completionTokens = json.eval_count;
          if (json.prompt_eval_cached_count) cachedTokens = json.prompt_eval_cached_count;
        } catch (e) {}
      }
    }
  }

  const fullLogs = thinking ? `<think>\n${thinking}\n</think>\n\n${reply}` : reply;
  const totalTokens = promptTokens + completionTokens;

  let modifiedFiles = 0;
  const regex = /(?:file:([^\n\r]+)[\r\n]+)?```[a-zA-Z0-9_\-]*[\r\n]+([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(reply)) !== null) {
    let filePath = match[1]?.trim();
    const fileContent = match[2];
    if (filePath) {
      const absPath = path.join(runDir, filePath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, fileContent, 'utf8');
      modifiedFiles++;
    }
  }

  const { stdout: diff } = await execAsync('git diff', { cwd: runDir });
  const { stdout: status } = await execAsync('git status -s', { cwd: runDir });

  return {
    branch: branchName,
    diff: diff.trim() || `(${modifiedFiles} files created/modified)`,
    status: status.trim() || 'Clean',
    logs: fullLogs.trim(),
    tokens: {
      total_tokens: totalTokens,
      input_tokens: promptTokens,
      cached_input_tokens: cachedTokens,
      output_tokens: completionTokens
    }
  };
}

async function executeCodex(target, prompt, branchName, cwdOverride) {
  const runDir = cwdOverride || target;
  if (!cwdOverride) {
    try {
      await execAsync(`git checkout -b ${branchName}`, { cwd: target });
    } catch (e) {}
  }

  const taskType = detectTaskType(prompt);
  const effectivePrompt = taskType === 'general'
    ? `[TASK TYPE: GENERAL CONSULTATION / ADVISORY / PLANNING]
Note: This is a general query, planning, or advisory question (NOT a file-editing code task).
Please respond directly, thoroughly, and comprehensively to the user's question in the requested language (e.g. Thai).
Do NOT attempt to search workspace files with rg/find or edit files unless explicitly instructed.

User Question:
${prompt}`
    : prompt;

  const promptFile = `/tmp/codex_mcp_prompt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.txt`;
  fs.writeFileSync(promptFile, effectivePrompt, 'utf8');

  const codexCmd = `cat "${promptFile}" | codex exec --dangerously-bypass-approvals-and-sandbox -C "${runDir}" -`;

  let stdout = '';
  let stderr = '';
  try {
    const res = await execAsync(codexCmd, {
      timeout: 15 * 60 * 1000,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }
    });
    stdout = res.stdout;
    stderr = res.stderr;
  } finally {
    try { fs.unlinkSync(promptFile); } catch (e) {}
  }
  const { stdout: diff } = await execAsync('git diff', { cwd: runDir });
  const { stdout: status } = await execAsync('git status -s', { cwd: runDir });
  const tokens = getLatestTokenUsage() || { total_tokens: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };

  return {
    branch: branchName,
    diff: diff.trim() || '(No tracked files modified)',
    status: status.trim() || 'Clean',
    logs: (stdout + '\n' + stderr).trim(),
    tokens
  };
}

function detectTaskType(prompt) {
  if (!prompt) return 'general';
  const lower = prompt.toLowerCase();

  const codeKeywords = [
    'code', 'function', 'class', 'bug', 'fix', 'refactor', 'test',
    'component', 'api', 'endpoint', 'npm', 'pip', 'python', 'javascript',
    'typescript', 'svelte', 'react', 'css', 'html', 'git', 'repo',
    'docker', 'database', 'sql', 'script', 'compile', 'build', 'import',
    'เขียนโค้ด', 'แก้โค้ด', 'แก้บั๊ก', 'สร้างไฟล์', 'ลบไฟล์', 'คอมไพล์',
    'เพิ่มฟังก์ชัน', 'เขียนโปรแกรม', 'สร้างคอมโพเนนต์', 'รันสคริปต์'
  ];

  const generalKeywords = [
    'เที่ยว', 'แพลน', 'เดินทาง', 'อาหาร', 'กิน', 'งบ', 'ประเมินงบ',
    'แนะนำ', 'คิดว่า', 'ความเห็น', 'ทำไม', 'อย่างไร', 'คืออะไร',
    'แปล', 'บทความ', 'แต่ง', 'เล่า', 'ประวัติ', 'วางแผน', 'เปรียบเทียบ',
    'travel', 'trip', 'budget', 'plan', 'why', 'what is', 'explain',
    'recommend', 'compare', 'opinion', 'summarize'
  ];

  let codeScore = 0;
  let generalScore = 0;

  for (const kw of codeKeywords) {
    if (lower.includes(kw)) codeScore++;
  }
  for (const kw of generalKeywords) {
    if (lower.includes(kw)) generalScore++;
  }

  if (generalScore > 0 && codeScore === 0) return 'general';
  if (codeScore > generalScore) return 'code';

  if (/[{}<>;`$]/.test(prompt) || /\b(src|app|lib|test|index|package)\b/i.test(prompt)) {
    return 'code';
  }

  return codeScore > 0 ? 'code' : 'general';
}

function slugifyPrompt(prompt) {
  let clean = (prompt || '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 35);
  const id = Math.random().toString(36).substring(2, 6);
  return 'temp-' + (clean || 'scratch') + '-' + id;
}

async function resolveWorkspace(wsName, prompt) {
  let finalName = wsName?.trim();
  if (!finalName || finalName === 'auto-temp' || finalName === 'temp') {
    finalName = slugifyPrompt(prompt);
  }
  const target = path.join(WORKSPACES_DIR, finalName);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
    const cleanTitle = (prompt || 'Scratch').replace(/[\r\n]+/g, ' ').slice(0, 100);
    fs.writeFileSync(path.join(target, 'README.md'), `# ${cleanTitle}\n\nAutomated scratch workspace.\n`, 'utf8');
    try {
      await execAsync('git init && git add README.md && git commit -m "init: automated scratch workspace"', { cwd: target });
    } catch (e) {}
  }
  return { finalName, target };
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'list_workspaces') {
      if (!fs.existsSync(WORKSPACES_DIR)) fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
      const files = fs.readdirSync(WORKSPACES_DIR);
      return { content: [{ type: 'text', text: files.length > 0 ? files.join('\n') : '(empty)' }] };
    }

    if (name === 'inspect_workspace') {
      const target = path.join(WORKSPACES_DIR, args.workspace);
      if (!fs.existsSync(target)) return { content: [{ type: 'text', text: `Workspace not found` }], isError: true };
      const { stdout: branch } = await execAsync('git branch --show-current 2>/dev/null || echo "none"', { cwd: target });
      const { stdout: status } = await execAsync('git status -s 2>/dev/null || echo ""', { cwd: target });
      const { stdout: files } = await execAsync('ls -la', { cwd: target });
      return {
        content: [{ type: 'text', text: `Branch: ${branch.trim()}\nStatus:\n${status || '(clean)'}\n\nFiles:\n${files}` }]
      };
    }

    if (name === 'clone_repo') {
      const folder = args.folderName ? args.folderName.trim() : '';
      const cmd = `git clone ${args.repoUrl} ${folder}`;
      const { stdout, stderr } = await execAsync(cmd, { cwd: WORKSPACES_DIR });
      return { content: [{ type: 'text', text: `Cloned successfully!\n${stdout}\n${stderr}` }] };
    }

    if (name === 'delete_workspace') {
      const wsName = path.basename(args.workspace);
      const target = path.join(WORKSPACES_DIR, wsName);
      if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
        return { content: [{ type: 'text', text: `Workspace '${wsName}' deleted successfully.` }] };
      }
      return { content: [{ type: 'text', text: `Workspace '${wsName}' not found.` }], isError: true };
    }

    if (name === 'run_codex_task') {
      const { finalName, target } = await resolveWorkspace(args.workspace, args.prompt);
      const b = args.branch || `agent/codex-${Date.now()}`;
      const r = await executeCodex(target, args.prompt, b);
      recordTaskHistory({
        workspace: finalName,
        prompt: args.prompt,
        provider: 'Codex (gpt-6.1-sol)',
        branch: r.branch,
        status: r.status,
        diff: r.diff,
        logs: r.logs,
        tokens: r.tokens,
        mode: 'single'
      });
      return {
        content: [{ type: 'text', text: `[Codex Completed]\nWorkspace: ${finalName}\nBranch: ${r.branch}\n\n=== DIFF ===\n${r.diff}\n\n=== LOGS ===\n${r.logs}` }]
      };
    }

    if (name === 'run_deepseek_task') {
      const { finalName, target } = await resolveWorkspace(args.workspace, args.prompt);
      const b = args.branch || `agent/deepseek-${Date.now()}`;
      const r = await executeDeepSeek(target, args.prompt, b);
      recordTaskHistory({
        workspace: finalName,
        prompt: args.prompt,
        provider: 'DeepSeek R1 (14b GPU)',
        branch: r.branch,
        status: r.status,
        diff: r.diff,
        logs: r.logs,
        tokens: r.tokens,
        mode: 'single'
      });
      return {
        content: [{ type: 'text', text: `[DeepSeek R1 Completed]\nWorkspace: ${finalName}\nBranch: ${r.branch}\n\n=== DIFF ===\n${r.diff}\n\n=== LOGS ===\n${r.logs}` }]
      };
    }

    if (name === 'run_dual_task') {
      const { finalName, target } = await resolveWorkspace(args.workspace, args.prompt);
      const ts = Date.now();
      const codexBranch = `agent/codex-${ts}`;
      const deepseekBranch = `agent/deepseek-${ts}`;

      const codexWorktree = await prepareWorktree(target, codexBranch, 'codex');
      const deepseekWorktree = await prepareWorktree(target, deepseekBranch, 'deepseek');

      let codexRes;
      let deepseekRes;

      try {
        const deepseekPromise = executeDeepSeek(target, args.prompt, deepseekBranch, deepseekWorktree.worktreePath).catch(err => ({
          branch: deepseekBranch,
          diff: '',
          status: 'Failed',
          logs: `DeepSeek Error: ${err.message}`,
          tokens: { total_tokens: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 }
        }));

        codexRes = await executeCodex(target, args.prompt, codexBranch, codexWorktree.worktreePath);
        deepseekRes = await deepseekPromise;
      } finally {
        await cleanupWorktree(target, codexWorktree, `Codex: ${args.prompt.slice(0, 50)}`);
        await cleanupWorktree(target, deepseekWorktree, `DeepSeek: ${args.prompt.slice(0, 50)}`);
      }

      recordTaskHistory({
        workspace: finalName,
        prompt: args.prompt,
        provider: 'Dual Agents (Codex + DeepSeek)',
        branch: `${codexRes.branch} & ${deepseekRes.branch}`,
        status: 'Dual Completed',
        diff: codexRes.diff,
        logs: `=== CODEX LOGS ===\n${codexRes.logs}\n\n=== DEEPSEEK LOGS ===\n${deepseekRes.logs}`,
        tokens: {
          total_tokens: (codexRes.tokens?.total_tokens || 0) + (deepseekRes.tokens?.total_tokens || 0),
          input_tokens: (codexRes.tokens?.input_tokens || 0) + (deepseekRes.tokens?.input_tokens || 0),
          cached_input_tokens: (codexRes.tokens?.cached_input_tokens || 0),
          output_tokens: (codexRes.tokens?.output_tokens || 0) + (deepseekRes.tokens?.output_tokens || 0)
        },
        mode: 'both',
        codex: codexRes,
        deepseek: deepseekRes
      });

      return {
        content: [{
          type: 'text',
          text: `[Dual Task Comparison (Git Worktrees Isolated)]\nWorkspace: ${finalName}\n\n=== 1. CODEX (gpt-6.1-sol) Branch: ${codexRes.branch} ===\n${codexRes.diff}\n\n=== 2. DEEPSEEK R1 (14b GPU) Branch: ${deepseekRes.branch} ===\n${deepseekRes.diff}`
        }]
      };
    }

    if (name === 'run_consensus_task') {
      const { finalName, target } = await resolveWorkspace(args.workspace, args.prompt);
      const ts = Date.now();
      const codexPropBranch = `agent/codex-prop-${ts}`;
      const deepseekPropBranch = `agent/deepseek-prop-${ts}`;
      const consensusBranch = `agent/consensus-${ts}`;

      // Stage 1: Parallel Generation in isolated worktrees
      const codexWorktree = await prepareWorktree(target, codexPropBranch, 'codex-prop');
      const deepseekWorktree = await prepareWorktree(target, deepseekPropBranch, 'deepseek-prop');

      let codexProp;
      let deepseekProp;

      try {
        const deepseekPromise = executeDeepSeek(target, args.prompt, deepseekPropBranch, deepseekWorktree.worktreePath).catch(err => ({
          branch: deepseekPropBranch,
          diff: '',
          status: 'Failed',
          logs: `DeepSeek Error: ${err.message}`,
          tokens: { total_tokens: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 }
        }));

        codexProp = await executeCodex(target, args.prompt, codexPropBranch, codexWorktree.worktreePath);
        deepseekProp = await deepseekPromise;
      } finally {
        await cleanupWorktree(target, codexWorktree, `Codex Proposal: ${args.prompt.slice(0, 50)}`);
        await cleanupWorktree(target, deepseekWorktree, `DeepSeek Proposal: ${args.prompt.slice(0, 50)}`);
      }

      // Stage 2: Bilateral Cross-Review
      const dsRevPrompt = `[PEER REVIEW REQUEST]
You are a Principal Software Architect & Auditor conducting a peer review of a solution proposed by OpenAI Codex for the following task.

=== ORIGINAL TASK ===
${args.prompt}

=== CODEX'S PROPOSAL & OUTPUT ===
${sanitizeForApi(codexProp.logs, 4000)}

=== CODEX'S GIT DIFF ===
${codexProp.diff || '(No diff recorded)'}

Please provide your rigorous peer review in Thai (and English for technical terms):
1. จุดเด่นของแนวทางนี้ (Key Strengths)
2. จุดบกพร่อง ช่องโหว่ หรือ Edge Cases ที่อาจเกิดขึ้น (Flaws, Vulnerabilities & Edge Cases)
3. ข้อเสนอแนะในการปรับปรุงให้สมบูรณ์ยิ่งขึ้น (Actionable Improvements)`;

      const codexRevPrompt = `[TASK TYPE: GENERAL CONSULTATION / PEER REVIEW AUDIT]
You are a Principal Software Architect & Auditor conducting a peer review of a solution proposed by DeepSeek R1 for the following task.

=== ORIGINAL TASK ===
${args.prompt}

=== DEEPSEEK R1 PROPOSAL & OUTPUT ===
${sanitizeForApi(deepseekProp.logs, 6000)}

=== DEEPSEEK R1 GIT DIFF ===
${deepseekProp.diff || '(No diff recorded)'}

Please provide your rigorous peer review in Thai (and English for technical terms):
1. จุดเด่นของแนวทางนี้ (Key Strengths)
2. จุดบกพร่อง ช่องโหว่ หรือ Edge Cases ที่อาจเกิดขึ้น (Flaws, Vulnerabilities & Edge Cases)
3. ข้อเสนอแนะในการปรับปรุงให้สมบูรณ์ยิ่งขึ้น (Actionable Improvements)`;

      const deepseekReviewPromise = (async () => {
        const res = await fetch(KMITL_API_URL, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${KMITL_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: DEEPSEEK_MODEL,
            messages: [
              { role: 'system', content: 'You are a Senior Software Architect and Code Auditor providing high-standard peer reviews in Thai.' },
              { role: 'user', content: dsRevPrompt }
            ]
          })
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          console.error(`[DeepSeek Review Error] HTTP ${res.status} ${res.statusText}: ${errText}`);
          return `DeepSeek Review failed (${res.status} ${res.statusText}): ${errText || 'Empty error body'}`;
        }
        const data = await res.json();
        const msg = data.message?.content || data.choices?.[0]?.message?.content || '';
        const think = data.message?.thinking ? `<think>\n${data.message.thinking}\n</think>\n\n` : '';
        return (think + msg).trim();
      })().catch(err => `DeepSeek Review Error: ${err.message}`);

      const codexReviewPromise = (async () => {
        const promptFile = `/tmp/codex_rev_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.txt`;
        fs.writeFileSync(promptFile, codexRevPrompt, 'utf8');
        try {
          const res = await execAsync(`cat "${promptFile}" | codex exec --dangerously-bypass-approvals-and-sandbox -C "${target}" -`, {
            timeout: 5 * 60 * 1000,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }
          });
          return (res.stdout + '\n' + res.stderr).trim();
        } finally {
          try { fs.unlinkSync(promptFile); } catch (e) {}
        }
      })().catch(err => `Codex Review Error: ${err.message}`);

      const [deepseekReviewOfCodex, codexReviewOfDeepSeek] = await Promise.all([
        deepseekReviewPromise,
        codexReviewPromise
      ]);

      // Stage 3: Consensus Harmonization
      const consensusPrompt = `[TASK TYPE: CONSENSUS HARMONIZATION & FINAL IMPLEMENTATION]
You are the Lead Consensus Multi-Agent Orchestrator.
We have executed a multi-agent debate and peer review between OpenAI Codex and DeepSeek R1.

=== ORIGINAL TASK ===
${args.prompt}

=== PROPOSAL A (Codex) ===
${codexProp.logs.slice(0, 5000)}
Diff: ${codexProp.diff || 'none'}

=== PEER REVIEW OF PROPOSAL A (by DeepSeek R1) ===
${deepseekReviewOfCodex.slice(0, 3500)}

=== PROPOSAL B (DeepSeek R1) ===
${deepseekProp.logs.slice(0, 5000)}
Diff: ${deepseekProp.diff || 'none'}

=== PEER REVIEW OF PROPOSAL B (by Codex) ===
${codexReviewOfDeepSeek.slice(0, 3500)}

=== YOUR MANDATE ===
1. Synthesize the final agreed solution (Consensus Solution), taking the best parts of both proposals and solving all issues raised in the peer reviews.
2. If this is a Code Task, apply the final, production-ready code directly into the workspace files.
3. Conclude with a clear Consensus Summary explaining what was harmonized and why this consensus is superior to each individual proposal alone.`;

      try {
        await execAsync(`git checkout -b ${consensusBranch}`, { cwd: target });
      } catch (e) {}

      const finalSolution = await executeCodex(target, consensusPrompt, consensusBranch);

      const totalTokens = (codexProp.tokens?.total_tokens || 0) +
        (deepseekProp.tokens?.total_tokens || 0) +
        (finalSolution.tokens?.total_tokens || 0);

      recordTaskHistory({
        workspace: finalName,
        prompt: args.prompt,
        provider: 'Multi-Agent Consensus (Codex + DeepSeek)',
        branch: consensusBranch,
        status: 'Consensus Achieved',
        diff: finalSolution.diff,
        logs: `=== CONSENSUS FINAL HARMONIZATION ===\n${finalSolution.logs}\n\n=== PEER REVIEW: DEEPSEEK ON CODEX ===\n${deepseekReviewOfCodex}\n\n=== PEER REVIEW: CODEX ON DEEPSEEK ===\n${codexReviewOfDeepSeek}\n\n=== INITIAL CODEX PROPOSAL ===\n${codexProp.logs}\n\n=== INITIAL DEEPSEEK PROPOSAL ===\n${deepseekProp.logs}`,
        tokens: {
          total_tokens: totalTokens,
          input_tokens: (codexProp.tokens?.input_tokens || 0) + (deepseekProp.tokens?.input_tokens || 0) + (finalSolution.tokens?.input_tokens || 0),
          cached_input_tokens: (codexProp.tokens?.cached_input_tokens || 0) + (finalSolution.tokens?.cached_input_tokens || 0),
          output_tokens: (codexProp.tokens?.output_tokens || 0) + (deepseekProp.tokens?.output_tokens || 0) + (finalSolution.tokens?.output_tokens || 0)
        },
        mode: 'consensus',
        consensus: {
          codexProposal: codexProp,
          deepseekProposal: deepseekProp,
          codexReviewOfDeepSeek,
          deepseekReviewOfCodex,
          finalSolution
        }
      });

      return {
        content: [{
          type: 'text',
          text: `[Multi-Agent Consensus Loop Completed]\nWorkspace: ${finalName}\nBranch: ${consensusBranch}\n\n=== FINAL CONSENSUS SOLUTION ===\n${finalSolution.logs}\n\n=== CONSENSUS DIFF ===\n${finalSolution.diff}`
        }]
      };
    }

    if (name === 'run_command') {
      const target = path.join(WORKSPACES_DIR, args.workspace);
      const { stdout, stderr } = await execAsync(args.command, { cwd: target, timeout: 5 * 60 * 1000 });
      return { content: [{ type: 'text', text: stdout + (stderr ? `\n[stderr]: ${stderr}` : '') }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);