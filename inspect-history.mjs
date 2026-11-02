import fs from 'fs';
const h = JSON.parse(fs.readFileSync('/opt/agent-bridge/tasks_history.json', 'utf8'));
console.log('Total items:', h.length);
h.forEach((x, i) => {
  console.log(`${i}: [${x.provider}] ${x.date} | Prompt: ${x.prompt}`);
});
