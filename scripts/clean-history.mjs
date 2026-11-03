import fs from 'fs';

const file = '/opt/agent-bridge/tasks_history.json';
if (fs.existsSync(file)) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const filtered = data.filter(x => !x.workspace?.startsWith('codex-') && !x.workspace?.includes('.worktrees'));
  fs.writeFileSync(file, JSON.stringify(filtered, null, 2), 'utf8');
  console.log(`Cleaned history: ${data.length} -> ${filtered.length}`);
}
