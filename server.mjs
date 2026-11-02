import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = util.promisify(exec);
const WORKSPACES_DIR = '/opt/agent-bridge/workspaces';
const KMITL_API_URL = 'https://aipass.cskmitl.com/v1/chat/completions';
const KMITL_TOKEN = 'gpu_910c7fbfed984909803659c2885e0d320746a068';
const DEEPSEEK_MODEL = 'deepseek-r1:14b';
const HISTORY_FILE = '/opt/agent-bridge/tasks_history.json';

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
      stream: false
    })
  });

  const data = await res.json();
  const reply = data.choices[0]?.message?.content || '';

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
    logs: reply.trim()
  };
}

async function executeCodex(target, prompt, branchName) {
  try {
    await execAsync(`git checkout -b ${branchName}`, { cwd: target });
  } catch (e) {}

  const escapedPrompt = prompt.replace(/"/g, '\\"');
  const codexCmd = `codex exec --dangerously-bypass-approvals-and-sandbox -C "${target}" "${escapedPrompt}" </dev/null`;

  const { stdout, stderr } = await execAsync(codexCmd, { timeout: 15 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 });
  const { stdout: diff } = await execAsync('git diff', { cwd: target });
  const { stdout: status } = await execAsync('git status -s', { cwd: target });

  return {
    branch: branchName,
    diff: diff.trim() || '(No tracked files modified)',
    status: status.trim() || 'Clean',
    logs: (stdout + '\n' + stderr).trim()
  };
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
      const target = path.join(WORKSPACES_DIR, args.workspace);
      const b = args.branch || `agent/codex-${Date.now()}`;
      const r = await executeCodex(target, args.prompt, b);
      recordTaskHistory({
        workspace: args.workspace,
        prompt: args.prompt,
        provider: 'Codex (gpt-6.1-sol)',
        branch: r.branch,
        status: r.status,
        diff: r.diff,
        logs: r.logs,
        mode: 'single'
      });
      return {
        content: [{ type: 'text', text: `[Codex Completed]\nBranch: ${r.branch}\n\n=== DIFF ===\n${r.diff}\n\n=== LOGS ===\n${r.logs}` }]
      };
    }

    if (name === 'run_deepseek_task') {
      const target = path.join(WORKSPACES_DIR, args.workspace);
      const b = args.branch || `agent/deepseek-${Date.now()}`;
      const r = await executeDeepSeek(target, args.prompt, b);
      recordTaskHistory({
        workspace: args.workspace,
        prompt: args.prompt,
        provider: 'DeepSeek R1 (14b GPU)',
        branch: r.branch,
        status: r.status,
        diff: r.diff,
        logs: r.logs,
        mode: 'single'
      });
      return {
        content: [{ type: 'text', text: `[DeepSeek R1 Completed]\nBranch: ${r.branch}\n\n=== DIFF ===\n${r.diff}\n\n=== LOGS ===\n${r.logs}` }]
      };
    }

    if (name === 'run_dual_task') {
      const target = path.join(WORKSPACES_DIR, args.workspace);
      const ts = Date.now();
      const codexRes = await executeCodex(target, args.prompt, `agent/codex-${ts}`);
      const deepseekRes = await executeDeepSeek(target, args.prompt, `agent/deepseek-${ts}`);

      recordTaskHistory({
        workspace: args.workspace,
        prompt: args.prompt,
        provider: 'Dual Agents (Codex + DeepSeek)',
        branch: `${codexRes.branch} & ${deepseekRes.branch}`,
        status: 'Dual Completed',
        diff: codexRes.diff,
        logs: `=== CODEX LOGS ===\n${codexRes.logs}\n\n=== DEEPSEEK LOGS ===\n${deepseekRes.logs}`,
        mode: 'both',
        codex: codexRes,
        deepseek: deepseekRes
      });

      return {
        content: [{
          type: 'text',
          text: `[Dual Task Comparison]\n\n=== 1. CODEX (gpt-6.1-sol) Branch: ${codexRes.branch} ===\n${codexRes.diff}\n\n=== 2. DEEPSEEK R1 (14b GPU) Branch: ${deepseekRes.branch} ===\n${deepseekRes.diff}`
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