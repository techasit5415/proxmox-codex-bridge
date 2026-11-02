import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = util.promisify(exec);
const WORKSPACES_DIR = '/opt/agent-bridge/workspaces';

const server = new Server(
  { name: 'proxmox-codex-bridge', version: '1.0.0' },
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
        description: 'สั่งให้ OpenAI Codex CLI แก้ไขโค้ดใน workspace แบบอัตโนมัติ พร้อมส่ง Git diff และ Logs กลับมา',
        inputSchema: {
          type: 'object',
          properties: {
            workspace: { type: 'string', description: 'ชื่อโฟลเดอร์โปรเจกต์ใน workspaces' },
            prompt: { type: 'string', description: 'คำสั่งงานเขียนโค้ดสำหรับ Codex' },
            branch: { type: 'string', description: 'ชื่อ branch ใหม่ (ถ้าไม่ระบุจะสร้างให้อัตโนมัติ)' }
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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'list_workspaces') {
      if (!fs.existsSync(WORKSPACES_DIR)) {
        fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
      }
      const files = fs.readdirSync(WORKSPACES_DIR);
      return {
        content: [{ type: 'text', text: files.length > 0 ? files.join('\n') : '(Workspaces directory is currently empty)' }]
      };
    }

    if (name === 'inspect_workspace') {
      const target = path.join(WORKSPACES_DIR, args.workspace);
      if (!fs.existsSync(target)) {
        return { content: [{ type: 'text', text: `Error: Workspace '${args.workspace}' does not exist.` }], isError: true };
      }
      const { stdout: branch } = await execAsync('git branch --show-current 2>/dev/null || echo "not a git repo"', { cwd: target });
      const { stdout: status } = await execAsync('git status -s 2>/dev/null || echo ""', { cwd: target });
      const { stdout: files } = await execAsync('ls -la', { cwd: target });
      return {
        content: [{ type: 'text', text: `Workspace: ${args.workspace}\nBranch: ${branch.trim()}\n\nGit Status:\n${status || '(clean)'}\n\nFiles:\n${files}` }]
      };
    }

    if (name === 'clone_repo') {
      const folder = args.folderName ? args.folderName.trim() : '';
      const cmd = `git clone ${args.repoUrl} ${folder}`;
      const { stdout, stderr } = await execAsync(cmd, { cwd: WORKSPACES_DIR });
      return {
        content: [{ type: 'text', text: `Repository cloned successfully!\n${stdout}\n${stderr}` }]
      };
    }

    if (name === 'run_codex_task') {
      const target = path.join(WORKSPACES_DIR, args.workspace);
      if (!fs.existsSync(target)) {
        return { content: [{ type: 'text', text: `Workspace '${args.workspace}' not found.` }], isError: true };
      }

      const taskBranch = args.branch || `agent/task-${Date.now()}`;
      try {
        await execAsync(`git checkout -b ${taskBranch}`, { cwd: target });
      } catch (e) {}

      // สั่ง Codex CLI exec ใน workspace โดย redirect </dev/null
      const escapedPrompt = args.prompt.replace(/"/g, '\\"');
      const codexCmd = `codex exec --dangerously-bypass-approvals-and-sandbox -C "${target}" "${escapedPrompt}" </dev/null`;

      const { stdout, stderr } = await execAsync(codexCmd, { timeout: 15 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 });
      const { stdout: diff } = await execAsync('git diff', { cwd: target });
      const { stdout: status } = await execAsync('git status -s', { cwd: target });

      return {
        content: [{
          type: 'text',
          text: `[Codex Task Completed]\nBranch: ${taskBranch}\n\n=== STATUS ===\n${status}\n\n=== DIFF ===\n${diff || '(No diff or files are untracked)'}\n\n=== LOGS ===\n${stdout}\n${stderr}`
        }]
      };
    }

    if (name === 'run_command') {
      const target = path.join(WORKSPACES_DIR, args.workspace);
      if (!fs.existsSync(target)) {
        return { content: [{ type: 'text', text: `Workspace '${args.workspace}' not found.` }], isError: true };
      }
      const { stdout, stderr } = await execAsync(args.command, { cwd: target, timeout: 5 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 });
      return {
        content: [{ type: 'text', text: stdout + (stderr ? `\n[stderr]: ${stderr}` : '') }]
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    return {
      content: [{ type: 'text', text: `[Error]: ${err.message}` }],
      isError: true
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);