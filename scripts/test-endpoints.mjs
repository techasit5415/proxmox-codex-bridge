const KMITL_TOKEN = process.env.KMITL_TOKEN || '';
const DEEPSEEK_MODEL = 'deepseek-r1:14b';

async function testV1() {
  console.log('--- Testing /v1/chat/completions ---');
  const res = await fetch('https://aipass.cskmitl.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KMITL_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [{ role: 'user', content: 'ตอบสั้นๆ 2+2 ได้เท่าไหร่ คิดในใจอย่างไร' }],
      stream: false
    })
  });
  const data = await res.json();
  console.log('Keys in message:', Object.keys(data.choices[0].message));
  console.log('message:', JSON.stringify(data.choices[0].message, null, 2));
}

async function testOllama() {
  console.log('\n--- Testing /api/chat ---');
  const res = await fetch('https://aipass.cskmitl.com/api/chat', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KMITL_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [{ role: 'user', content: 'ตอบสั้นๆ 2+2 ได้เท่าไหร่ คิดในใจอย่างไร' }],
      stream: false
    })
  });
  const data = await res.json();
  console.log('Ollama response keys:', Object.keys(data));
  console.log('Ollama message:', JSON.stringify(data.message, null, 2));
}

async function main() {
  await testV1();
  await testOllama();
}

main().catch(console.error);
