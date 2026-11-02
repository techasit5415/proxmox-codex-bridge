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
const KMITL_TOKEN = 'gpu_910c7fbfed984909803659c2885e0d320746a068';
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
        description: 'สั่งทั้ง Codex (gpt-6.1-sol) และ DeepSeek R1 (14b GPU) ทำงานพร้อมกันบนคนละ branch เพื่อเปรียบเทียบ diff',
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

async function executeDeepSeek(target, prompt, branchName) {
  try {
    await execAsync(`git checkout -b ${branchName}`, { cwd: target });
  } catch (e) {}

  const { stdout: fileList } = await execAsync('git ls-files | head -n 40', { cwd: target });

  const systemPrompt = `You are an expert software engineer. Given a user task and workspace files, generate the necessary code changes.
Format your response using this syntax:

file:path/to/file.ext
\`\`\`language
<complete file content here>
\`\`\`
`;

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
        { role: 'user', content: `Workspace files:\n${fileList}\n\nTask:\n${prompt}` }
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
      const absPath = path.join(target, filePath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, fileContent, 'utf8');
      modifiedFiles++;
    }
  }

  const { stdout: diff } = await execAsync('git diff', { cwd: target });
  const { stdout: status } = await execAsync('git status -s', { cwd: target });

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

async function executeCodex(target, prompt, branchName) {
  try {
    await execAsync(`git checkout -b ${branchName}`, { cwd: target });
  } catch (e) {}

  const promptFile = `/tmp/codex_mcp_prompt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.txt`;
  fs.writeFileSync(promptFile, prompt, 'utf8');

  const codexCmd = `cat "${promptFile}" | codex exec --dangerously-bypass-approvals-and-sandbox -C "${target}" -`;

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
  const { stdout: diff } = await execAsync('git diff', { cwd: target });
  const { stdout: status } = await execAsync('git status -s', { cwd: target });
  const tokens = getLatestTokenUsage() || { total_tokens: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };

  return {
    branch: branchName,
    diff: diff.trim() || '(No tracked files modified)',
    status: status.trim() || 'Clean',
    logs: (stdout + '\n' + stderr).trim(),
    tokens
  };
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
      // Start DeepSeek network query concurrently with Codex CLI (with error boundary)
      const deepseekPromise = executeDeepSeek(target, args.prompt, `agent/deepseek-${ts}`).catch(err => ({
        branch: `agent/deepseek-${ts}`,
        diff: '',
        status: 'Failed',
        logs: `DeepSeek Error: ${err.message}`,
        tokens: { total_tokens: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 }
      }));
      const codexRes = await executeCodex(target, args.prompt, `agent/codex-${ts}`);
      const deepseekRes = await deepseekPromise;

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
          text: `[Dual Task Comparison]\nWorkspace: ${finalName}\n\n=== 1. CODEX (gpt-6.1-sol) Branch: ${codexRes.branch} ===\n${codexRes.diff}\n\n=== 2. DEEPSEEK R1 (14b GPU) Branch: ${deepseekRes.branch} ===\n${deepseekRes.diff}`
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