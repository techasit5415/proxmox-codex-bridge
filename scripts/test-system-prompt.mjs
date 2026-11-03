const KMITL_TOKEN = process.env.KMITL_TOKEN || '';
const DEEPSEEK_MODEL = 'deepseek-r1:14b';

async function testWithSystem() {
  console.log('--- Testing WITH system prompt ---');
  const res = await fetch('https://aipass.cskmitl.com/api/chat', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KMITL_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: 'You are an expert engineer. Output format: file:path' },
        { role: 'user', content: 'Explain 1+1' }
      ],
      stream: false
    })
  });
  const data = await res.json();
  console.log('Thinking with system prompt:', data.message?.thinking ? 'YES (' + data.message.thinking.length + ' chars)' : 'NO (missing)');
}

async function testWithoutSystem() {
  console.log('--- Testing WITHOUT system prompt ---');
  const res = await fetch('https://aipass.cskmitl.com/api/chat', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KMITL_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'user', content: 'Explain 1+1' }
      ],
      stream: false
    })
  });
  const data = await res.json();
  console.log('Thinking without system prompt:', data.message?.thinking ? 'YES (' + data.message.thinking.length + ' chars)' : 'NO (missing)');
}

async function main() {
  await testWithSystem();
  await testWithoutSystem();
}

main().catch(console.error);
