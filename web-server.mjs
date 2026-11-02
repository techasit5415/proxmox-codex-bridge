import express from 'express';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = util.promisify(exec);
const WORKSPACES_DIR = '/opt/agent-bridge/workspaces';
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());

// API: Check System & Codex Status
app.get('/api/status', async (req, res) => {
  try {
    const isAuthed = fs.existsSync('/root/.codex/auth.json');
    const { stdout: df } = await execAsync("df -h / | awk 'NR==2 {print $3 \" / \" $2 \" (\" $5 \")\"}'");
    const { stdout: nodeVer } = await execAsync('node -v');
    const { stdout: codexVer } = await execAsync('codex --version 2>/dev/null || echo "codex-cli"');

    res.json({
      status: 'online',
      codexAuth: isAuthed ? 'Logged in (ChatGPT Plus)' : 'Not Logged in',
      codexVersion: codexVer.trim(),
      nodeVersion: nodeVer.trim(),
      diskUsage: df.trim(),
      workspacesDir: WORKSPACES_DIR
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: List Workspaces
app.get('/api/workspaces', async (req, res) => {
  try {
    if (!fs.existsSync(WORKSPACES_DIR)) {
      fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
    }
    const dirs = fs.readdirSync(WORKSPACES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    res.json({ workspaces: dirs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get Workspace Details
app.get('/api/workspaces/:name', async (req, res) => {
  try {
    const target = path.join(WORKSPACES_DIR, req.params.name);
    if (!fs.existsSync(target)) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    const { stdout: branch } = await execAsync('git branch --show-current 2>/dev/null || echo "none"', { cwd: target });
    const { stdout: status } = await execAsync('git status -s 2>/dev/null || echo ""', { cwd: target });
    const { stdout: recentLogs } = await execAsync('git log -n 5 --oneline 2>/dev/null || echo "No commits yet"', { cwd: target });
    const files = fs.readdirSync(target);

    res.json({
      name: req.params.name,
      branch: branch.trim(),
      status: status.trim() || '(Working tree clean)',
      recentCommits: recentLogs.trim().split('\n'),
      files
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Clone Git Repo
app.post('/api/clone', async (req, res) => {
  const { repoUrl, folderName } = req.body;
  if (!repoUrl) return res.status(400).json({ error: 'repoUrl is required' });

  try {
    const dest = folderName ? folderName.trim() : '';
    const cmd = `git clone ${repoUrl} ${dest}`;
    const { stdout, stderr } = await execAsync(cmd, { cwd: WORKSPACES_DIR, timeout: 60000 });
    res.json({ success: true, message: 'Repo cloned successfully', logs: stdout + stderr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Run Codex Task
app.post('/api/run-task', async (req, res) => {
  const { workspace, prompt, branch } = req.body;
  if (!workspace || !prompt) return res.status(400).json({ error: 'workspace and prompt required' });

  const target = path.join(WORKSPACES_DIR, workspace);
  if (!fs.existsSync(target)) return res.status(404).json({ error: 'Workspace not found' });

  const taskBranch = branch || `agent/task-${Date.now()}`;
  try {
    try {
      await execAsync(`git checkout -b ${taskBranch}`, { cwd: target });
    } catch (e) {}

    const escapedPrompt = prompt.replace(/"/g, '\\"');
    const codexCmd = `codex exec --dangerously-bypass-approvals-and-sandbox -C "${target}" "${escapedPrompt}" </dev/null`;

    const { stdout, stderr } = await execAsync(codexCmd, { timeout: 15 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 });
    const { stdout: diff } = await execAsync('git diff', { cwd: target });
    const { stdout: status } = await execAsync('git status -s', { cwd: target });

    res.json({
      success: true,
      branch: taskBranch,
      status: status.trim() || '(Clean)',
      diff: diff.trim() || '(No modified tracked files)',
      logs: (stdout + '\n' + stderr).trim()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Run Custom Bash Command
app.post('/api/run-cmd', async (req, res) => {
  const { workspace, command } = req.body;
  if (!workspace || !command) return res.status(400).json({ error: 'workspace and command required' });

  const target = path.join(WORKSPACES_DIR, workspace);
  if (!fs.existsSync(target)) return res.status(404).json({ error: 'Workspace not found' });

  try {
    const { stdout, stderr } = await execAsync(command, { cwd: target, timeout: 5 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 });
    res.json({ output: stdout + (stderr ? '\n[stderr]:\n' + stderr : '') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve Single Page Application UI
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Codex CT Agent Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            brand: { 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca' }
          }
        }
      }
    }
  </script>
  <style>
    pre code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex flex-col antialiased">

  <!-- Header -->
  <header class="border-b border-slate-800 bg-slate-900/80 backdrop-blur px-6 py-4 sticky top-0 z-50 flex items-center justify-between">
    <div class="flex items-center space-x-3">
      <div class="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/30">⚡</div>
      <div>
        <h1 class="font-bold text-base tracking-wide flex items-center gap-2">
          Codex Agent Dashboard
          <span class="text-xs font-mono font-normal px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Proxmox CT</span>
        </h1>
        <p class="text-xs text-slate-400">Autonomous Coding Agent &bull; 24/7 Background Runner</p>
      </div>
    </div>
    
    <div id="system-stats" class="flex items-center gap-4 text-xs font-mono">
      <div class="flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-800/80 border border-slate-700">
        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        <span id="auth-status" class="text-slate-300">Checking auth...</span>
      </div>
      <div class="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800/80 border border-slate-700 text-slate-400">
        <span>Disk:</span>
        <span id="disk-status" class="text-slate-200">...</span>
      </div>
    </div>
  </header>

  <!-- Main Container -->
  <div class="flex-1 flex max-w-7xl w-full mx-auto p-6 gap-6 flex-col lg:flex-row">
    
    <!-- Sidebar / Workspaces -->
    <aside class="w-full lg:w-72 flex flex-col gap-4">
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-slate-400">Workspaces</h2>
          <button onclick="openCloneModal()" class="text-xs px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 font-medium transition text-white">+ Clone</button>
        </div>
        <div id="workspace-list" class="flex flex-col gap-1.5 max-h-72 overflow-y-auto pr-1">
          <div class="text-xs text-slate-500 italic py-2">Loading workspaces...</div>
        </div>
      </div>

      <!-- Quick Command Runner -->
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-slate-400">Quick Terminal</h2>
        <form onsubmit="runQuickCmd(event)" class="flex flex-col gap-2">
          <input id="quick-cmd" type="text" placeholder="e.g. npm test or git status" class="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono focus:outline-none focus:border-indigo-500 text-slate-200">
          <button type="submit" class="w-full py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium transition text-slate-300">Run Command</button>
        </form>
      </div>
    </aside>

    <!-- Main Content Area -->
    <main class="flex-1 flex flex-col gap-6">
      
      <!-- Task Submission Card -->
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-4 shadow-xl">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="font-semibold text-slate-100 flex items-center gap-2">
              <span>🚀 Dispatch Codex Task</span>
            </h3>
            <p class="text-xs text-slate-400">Target Workspace: <span id="active-ws-label" class="font-mono text-indigo-400 font-bold">demo-project</span></p>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-slate-500">Plan:</span>
            <span class="text-xs font-medium px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">ChatGPT Plus (gpt-6.1-sol)</span>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <textarea id="prompt-input" rows="3" placeholder="Describe the task for Codex in detail (e.g. Add an endpoint /api/users that validates email and hashes password with bcrypt, then write unit tests)..." class="w-full p-3 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-sans resize-none"></textarea>
          
          <div class="flex items-center justify-between pt-1">
            <div class="flex items-center gap-2">
              <input id="branch-input" type="text" placeholder="Custom branch (optional)" class="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs font-mono text-slate-300 focus:outline-none focus:border-indigo-500">
            </div>
            <button id="run-task-btn" onclick="submitTask()" class="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-lg shadow-indigo-600/30 transition flex items-center gap-2">
              <span id="btn-spinner" class="hidden animate-spin">&#9696;</span>
              <span id="btn-text">Execute with Codex</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Execution Results Tabs -->
      <div id="results-panel" class="bg-slate-900 border border-slate-800 rounded-xl flex-1 flex flex-col overflow-hidden shadow-xl min-h-[400px]">
        <div class="flex items-center justify-between border-b border-slate-800 px-4 bg-slate-950/50">
          <div class="flex items-center space-x-1">
            <button onclick="switchTab('diff')" id="tab-btn-diff" class="px-4 py-3 text-xs font-medium border-b-2 border-indigo-500 text-indigo-400">Git Diff</button>
            <button onclick="switchTab('logs')" id="tab-btn-logs" class="px-4 py-3 text-xs font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-200">Agent Logs</button>
            <button onclick="switchTab('workspace')" id="tab-btn-workspace" class="px-4 py-3 text-xs font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-200">Files & Git Info</button>
          </div>
          <div id="task-status-badge" class="text-xs font-mono text-slate-500">Ready</div>
        </div>

        <div class="p-4 flex-1 overflow-auto bg-slate-950 font-mono text-xs">
          <!-- Diff Tab -->
          <pre id="tab-content-diff" class="text-emerald-400 whitespace-pre-wrap leading-relaxed">// Git diff will appear here after task execution...</pre>

          <!-- Logs Tab -->
          <pre id="tab-content-logs" class="hidden text-slate-300 whitespace-pre-wrap leading-relaxed">// Execution logs and test runner output will appear here...</pre>

          <!-- Workspace Info Tab -->
          <div id="tab-content-workspace" class="hidden flex flex-col gap-4 text-slate-300">
            <div>
              <div class="text-slate-500 font-semibold mb-1">CURRENT BRANCH & STATUS:</div>
              <pre id="ws-git-status" class="p-3 bg-slate-900 rounded border border-slate-800 text-slate-300"></pre>
            </div>
            <div>
              <div class="text-slate-500 font-semibold mb-1">FILES IN REPOSITORY:</div>
              <div id="ws-files-list" class="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 bg-slate-900 rounded border border-slate-800"></div>
            </div>
          </div>
        </div>
      </div>

    </main>
  </div>

  <!-- Modal Clone Repo -->
  <div id="clone-modal" class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
    <div class="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 flex flex-col gap-4 shadow-2xl">
      <h3 class="font-bold text-sm text-slate-100">Clone Git Repository</h3>
      <div class="flex flex-col gap-3">
        <div>
          <label class="text-xs text-slate-400 block mb-1">Git Clone URL (HTTPS or SSH)</label>
          <input id="clone-url" type="text" placeholder="https://github.com/user/repo.git" class="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-xs text-slate-200 focus:outline-none focus:border-indigo-500">
        </div>
        <div>
          <label class="text-xs text-slate-400 block mb-1">Custom Folder Name (Optional)</label>
          <input id="clone-folder" type="text" placeholder="e.g. my-app" class="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-xs text-slate-200 focus:outline-none focus:border-indigo-500">
        </div>
      </div>
      <div class="flex items-center justify-end gap-2 pt-2">
        <button onclick="closeCloneModal()" class="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200">Cancel</button>
        <button onclick="executeClone()" class="px-4 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded transition">Clone to Server</button>
      </div>
    </div>
  </div>

  <!-- Script logic -->
  <script>
    let activeWorkspace = 'demo-project';

    async function loadStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        document.getElementById('auth-status').innerText = data.codexAuth;
        document.getElementById('disk-status').innerText = data.diskUsage;
      } catch (e) {
        document.getElementById('auth-status').innerText = 'Offline';
      }
    }

    async function loadWorkspaces() {
      try {
        const res = await fetch('/api/workspaces');
        const data = await res.json();
        const list = document.getElementById('workspace-list');
        list.innerHTML = '';
        if (data.workspaces.length === 0) {
          list.innerHTML = '<div class="text-xs text-slate-500 py-1">No repositories found</div>';
          return;
        }
        data.workspaces.forEach(ws => {
          const btn = document.createElement('button');
          btn.className = 'w-full text-left px-3 py-2 rounded-lg text-xs font-mono transition flex items-center justify-between ' + 
            (ws === activeWorkspace ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200');
          btn.innerHTML = '<span>' + ws + '</span>' + (ws === activeWorkspace ? '<span class="text-[10px] text-indigo-400 font-bold">&#10003;</span>' : '');
          btn.onclick = () => selectWorkspace(ws);
          list.appendChild(btn);
        });
        loadWorkspaceDetails(activeWorkspace);
      } catch (e) {
        console.error(e);
      }
    }

    function selectWorkspace(ws) {
      activeWorkspace = ws;
      document.getElementById('active-ws-label').innerText = ws;
      loadWorkspaces();
    }

    async function loadWorkspaceDetails(ws) {
      try {
        const res = await fetch('/api/workspaces/' + ws);
        const data = await res.json();
        document.getElementById('ws-git-status').innerText = 'Branch: ' + data.branch + '\nStatus: ' + data.status;
        const filesEl = document.getElementById('ws-files-list');
        filesEl.innerHTML = '';
        data.files.forEach(f => {
          const item = document.createElement('div');
          item.className = 'px-2 py-1 bg-slate-950 rounded text-slate-400 border border-slate-800/80 text-[11px] truncate';
          item.innerText = f;
          filesEl.appendChild(item);
        });
      } catch (e) {}
    }

    async function submitTask() {
      const prompt = document.getElementById('prompt-input').value.trim();
      const branch = document.getElementById('branch-input').value.trim();
      if (!prompt) return alert('Please enter a task description');

      const btn = document.getElementById('run-task-btn');
      const spinner = document.getElementById('btn-spinner');
      const text = document.getElementById('btn-text');
      const badge = document.getElementById('task-status-badge');

      btn.disabled = true;
      spinner.classList.remove('hidden');
      text.innerText = 'Running Codex...';
      badge.innerText = 'Executing in Sandbox...';
      badge.className = 'text-xs font-mono text-amber-400 animate-pulse';

      try {
        const res = await fetch('/api/run-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspace: activeWorkspace, prompt, branch })
        });
        const data = await res.json();

        if (data.success) {
          badge.innerText = 'Completed (' + data.branch + ')';
          badge.className = 'text-xs font-mono text-emerald-400';
          document.getElementById('tab-content-diff').innerText = data.diff || '(No tracked files modified)';
          document.getElementById('tab-content-logs').innerText = data.logs;
          switchTab('diff');
          loadWorkspaceDetails(activeWorkspace);
        } else {
          badge.innerText = 'Failed';
          badge.className = 'text-xs font-mono text-rose-400';
          document.getElementById('tab-content-logs').innerText = data.error || 'Execution failed';
          switchTab('logs');
        }
      } catch (e) {
        badge.innerText = 'Error';
        badge.className = 'text-xs font-mono text-rose-400';
        document.getElementById('tab-content-logs').innerText = e.message;
        switchTab('logs');
      } finally {
        btn.disabled = false;
        spinner.classList.add('hidden');
        text.innerText = 'Execute with Codex';
      }
    }

    async function runQuickCmd(e) {
      e.preventDefault();
      const cmd = document.getElementById('quick-cmd').value.trim();
      if (!cmd) return;
      document.getElementById('tab-content-logs').innerText = 'Running: ' + cmd + '...\n';
      switchTab('logs');
      try {
        const res = await fetch('/api/run-cmd', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspace: activeWorkspace, command: cmd })
        });
        const data = await res.json();
        document.getElementById('tab-content-logs').innerText = data.output || data.error;
      } catch (err) {
        document.getElementById('tab-content-logs').innerText = err.message;
      }
    }

    function switchTab(tab) {
      ['diff', 'logs', 'workspace'].forEach(t => {
        document.getElementById('tab-content-' + t).classList.add('hidden');
        document.getElementById('tab-btn-' + t).className = 'px-4 py-3 text-xs font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-200';
      });
      document.getElementById('tab-content-' + tab).classList.remove('hidden');
      document.getElementById('tab-btn-' + tab).className = 'px-4 py-3 text-xs font-medium border-b-2 border-indigo-500 text-indigo-400';
    }

    function openCloneModal() { document.getElementById('clone-modal').classList.remove('hidden'); }
    function closeCloneModal() { document.getElementById('clone-modal').classList.add('hidden'); }

    async function executeClone() {
      const repoUrl = document.getElementById('clone-url').value.trim();
      const folderName = document.getElementById('clone-folder').value.trim();
      if (!repoUrl) return alert('Please enter git URL');
      closeCloneModal();
      try {
        const res = await fetch('/api/clone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repoUrl, folderName })
        });
        const data = await res.json();
        if (data.success) {
          alert('Cloned successfully!');
          loadWorkspaces();
        } else {
          alert('Error: ' + data.error);
        }
      } catch (e) {
        alert(e.message);
      }
    }

    loadStatus();
    loadWorkspaces();
  </script>
</body>
</html>
`);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Web Dashboard running on http://0.0.0.0:${PORT}`);
});