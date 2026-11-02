async function run() {
  const res = await fetch("http://127.0.0.1:3000/api/task", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace: "Android-Tv",
      prompt: "วิเคราะห์ commit 95bdc88 สำหรับ Android 9 TV",
      provider: "deepseek"
    })
  });
  const data = await res.json();
  console.log("Provider:", data.provider);
  console.log("Has <think>?:", data.logs?.includes("<think>") ? "YES" : "NO");
  if (data.logs?.includes("<think>")) {
    const think = data.logs.match(/<think>([\s\S]*?)<\/think>/);
    console.log("Thinking extract:", think ? think[1].substring(0, 200) : "not matched");
  }
}
run().catch(console.error);
