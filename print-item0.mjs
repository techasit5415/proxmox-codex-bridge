import fs from 'fs';
const h = JSON.parse(fs.readFileSync('/opt/agent-bridge/tasks_history.json', 'utf8'));
console.log('=== ITEM 0 ===');
console.log('Prompt:', h[0].prompt);
console.log('Diff:', h[0].diff);
console.log('Logs:\n', h[0].logs);
