import http from 'http';

const data = JSON.stringify({
  workspace: 'Android-Tv',
  provider: 'both',
  prompt: 'ทั้งคู่คิดว่าควรเพิ่มฟีเจอร์อะไรอีกใน Android-Tv Launcher สำหรับ TCL BeyondTV Android 9 (เช่น โหมดฟังเพลงปิดจอ Screen-Off, Quick Menu, Memory Optimizer) วิเคราะห์โค้ดและแนะนำแนวทาง implementation'
});

const req = http.request({
  hostname: '127.0.0.1',
  port: 3000,
  path: '/api/task',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data, 'utf8')
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    try {
      const parsed = JSON.parse(body);
      console.log('Status Code:', res.statusCode);
      console.log('Success:', parsed.success, 'Mode:', parsed.mode);
      if (parsed.codex) {
        console.log('Codex branch:', parsed.codex.branch, 'Tokens:', parsed.codex.tokens?.total_tokens);
        console.log('Codex logs sample:', (parsed.codex.logs || '').slice(0, 150));
      }
      if (parsed.deepseek) {
        console.log('DeepSeek branch:', parsed.deepseek.branch, 'Tokens:', parsed.deepseek.tokens?.total_tokens);
        console.log('DeepSeek logs sample:', (parsed.deepseek.logs || '').slice(0, 150));
      }
    } catch(e) {
      console.log('Raw response:', body.slice(0, 500));
    }
  });
});

req.on('error', (e) => console.error('Req error:', e));
req.write(data);
req.end();
