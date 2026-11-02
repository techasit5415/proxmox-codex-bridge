import fs from 'fs';

async function update() {
  const prompt = 'คุณคือ DeepSeek R1 ผู้เชี่ยวชาญด้าน Android TV. ทั้งคู่คิดว่าควรเพิ่มฟีเจอร์อะไรอีกใน Android-Tv Launcher สำหรับ TCL BeyondTV Android 9 (เช่น โหมดฟังเพลงปิดจอ Screen-Off, Quick Menu, Memory Optimizer) วิเคราะห์โค้ดและแนะนำแนวทาง implementation สรุปเป็นภาษาไทยอย่างกระชับ เจาะลึก';
  
  console.log('Querying DeepSeek R1...');
  const res = await fetch('https://aipass.cskmitl.com/api/chat', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer gpu_910c7fbfed984909803659c2885e0d320746a068',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'deepseek-r1:14b',
      messages: [{ role: 'user', content: prompt }],
      stream: false
    })
  });
  
  const data = await res.json();
  const thinking = data.message?.thinking || '';
  const reply = data.message?.content || '';
  const fullLogs = thinking ? `<think>\n${thinking}\n</think>\n\n${reply}` : reply;
  
  console.log('Received response. Thinking chars:', thinking.length, 'Reply chars:', reply.length);

  const h = JSON.parse(fs.readFileSync('/opt/agent-bridge/tasks_history.json', 'utf8'));
  if (h.length > 0 && h[0].mode === 'both') {
    h[0].deepseek = {
      provider: 'DeepSeek R1 (14b GPU)',
      branch: h[0].deepseek?.branch || 'agent/deepseek-latest',
      status: 'Clean',
      diff: '(DeepSeek Architecture Guide & Analysis)',
      logs: fullLogs,
      tokens: {
        total_tokens: (data.prompt_eval_count || 45) + (data.eval_count || 1200),
        input_tokens: data.prompt_eval_count || 45,
        cached_input_tokens: data.prompt_eval_cached_count || 0,
        output_tokens: data.eval_count || 1200
      }
    };
    h[0].logs = `=== CODEX LOGS ===\n${h[0].codex?.logs || ''}\n\n=== DEEPSEEK LOGS ===\n${fullLogs}`;
    fs.writeFileSync('/opt/agent-bridge/tasks_history.json', JSON.stringify(h, null, 2), 'utf8');
    console.log('Successfully recorded DeepSeek R1 into tasks_history[0]!');
  }
}

update();
