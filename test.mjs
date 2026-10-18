
const base = (process.env.AGY_BASE_URL || ('http://127.0.0.1:' + (process.env.AGY_PORT || 8787) + '/v1')) + '/chat/completions';
const model = process.env.AGY_TEST_MODEL || 'gemini-3-flash';

async function call(body, stream = false) {
  const r = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stream }),
  });
  if (!stream) return { status: r.status, json: await r.json() };
  return { status: r.status, text: await r.text() };
}

let r = await call({ model, messages: [{ role: 'user', content: 'Say exactly: hello from antigravity' }] });
console.log('NONSTREAM', r.status, JSON.stringify(r.json?.choices?.[0]?.message));

r = await call({ model, messages: [{ role: 'user', content: 'Count 1 to 3' }] }, true);
console.log('STREAM', r.status, r.text.includes('data: [DONE]') ? 'ok' : 'no DONE marker');

const tools = [{
  type: 'function',
  function: { name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } },
}];
r = await call({ model, messages: [{ role: 'user', content: 'What is the weather in Hanoi? Use the tool.' }], tools, tool_choice: 'auto' });
const msg = r.json?.choices?.[0]?.message;
console.log('TOOLCALL', r.status, msg?.tool_calls?.[0]?.function?.name || '(none)');

if (msg?.tool_calls?.length) {
  const tc = msg.tool_calls[0];
  r = await call({
    model,
    tools,
    messages: [
      { role: 'user', content: 'What is the weather in Hanoi? Use the tool.' },
      { role: 'assistant', content: null, tool_calls: [tc] },
      { role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ tempC: 31, conditions: 'humid' }) },
    ],
  });
  console.log('TOOL RESULT', r.status, JSON.stringify(r.json?.choices?.[0]?.message?.content));
}
