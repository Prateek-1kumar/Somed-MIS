const key = process.env.GEMINI_API_KEY;
for (const model of ['gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-lite']) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const t = Date.now();
  const res = await fetch(url, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] }),
  });
  const body = await res.text();
  if (res.ok) {
    console.log(`${model}: OK (${Date.now()-t}ms)`);
  } else {
    let violations = [];
    try {
      const j = JSON.parse(body);
      for (const d of j.error?.details ?? []) for (const v of d.violations ?? []) violations.push(v.quotaId);
    } catch {}
    console.log(`${model}: ${res.status}  violations=[${violations.join(', ')}]`);
  }
  await new Promise(r => setTimeout(r, 200));
}
