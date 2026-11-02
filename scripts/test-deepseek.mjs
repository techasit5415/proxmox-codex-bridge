const KMITL_API_URL = 'https://aipass.cskmitl.com/v1/chat/completions';
const KMITL_TOKEN = 'gpu_910c7fbfed984909803659c2885e0d320746a068';
const DEEPSEEK_MODEL = 'deepseek-r1:14b';

async function test() {
  const res = await fetch(KMITL_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KMITL_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [{ role: 'user', content: '1+1 เท่ากับเท่าไหร่' }],
      stream: false
    })
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

test().catch(console.error);
