
import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  ensureAccessToken,
  getNextAccount,
  refreshAccount,
  markCooldown,
  loadPool,
  loadCredential,
  headers,
  ENDPOINTS,
} from './lib/auth.mjs';

const MODEL_TTL = 5 * 60 * 1000;
const UPSTREAM_TIMEOUT = Number(process.env.AGY_TIMEOUT_MS || 180000);
let modelsCache = null;
let modelsAt = 0;
const nonChat = /^(tab_|chat_\d|.*image.*)/i;

function log(...a) { console.error('[agy]', ...a); }

const b64u = {
  enc: (s) => Buffer.from(s, 'utf8').toString('base64url'),
  dec: (s) => { try { return Buffer.from(s, 'base64url').toString('utf8'); } catch { return null; } },
};

// Gemini 3 bắt buộc replay thoughtSignature của functionCall. OpenAI không có field này,
// nên chữ ký đi kèm trong tool_call id: "<id>__<base64url(sig)>".
function toolId(call) {
  const base = call.id || ('call_' + crypto.randomBytes(8).toString('hex'));
  return call.sig ? base + '__' + b64u.enc(call.sig) : base;
}
function splitToolId(id) {
  const i = id.lastIndexOf('__');
  if (i < 0) return { id, sig: null };
  const sig = b64u.dec(id.slice(i + 2));
  return sig ? { id: id.slice(0, i), sig } : { id, sig: null };
}

async function upstream(path, body, { stream = false } = {}) {
  const triedEmails = [];
  const pool = loadPool();
  const totalAccounts = Math.max(1, pool.accounts?.length || 1);

  for (let attempt = 0; attempt < totalAccounts; attempt++) {
    let account;
    try {
      account = await getNextAccount(triedEmails);
    } catch (err) {
      if (triedEmails.length > 0) {
        log('Tat ca tai khoan kha dung trong pool deu da duoc thu.');
      }
      throw err;
    }

    triedEmails.push(account.email);
    let tk = account.token.access_token;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT);
    let res;
    try {
      res = await fetch(ENDPOINTS.daily + path, {
        method: 'POST',
        headers: headers(tk, stream ? { Accept: 'text/event-stream' } : {}),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401) {
      try {
        const refreshed = await refreshAccount(account);
        tk = refreshed.token.access_token;
        res = await fetch(ENDPOINTS.daily + path, {
          method: 'POST',
          headers: headers(tk, stream ? { Accept: 'text/event-stream' } : {}),
          body: JSON.stringify(body),
        });
      } catch (e) {
        log('Refresh token that bai cho ' + account.email + ':', e.message);
      }
    }

    if (res.status === 429 || res.status === 503) {
      const errText = await res.clone().text().catch(() => '');
      const isQuota = res.status === 429 || /QUOTA_EXHAUSTED|RESOURCE_EXHAUSTED|MODEL_CAPACITY_EXHAUSTED|quota|capacity/i.test(errText);

      if (isQuota && totalAccounts > 1 && triedEmails.length < totalAccounts) {
        markCooldown(account.email, 15 * 60 * 1000, 'HTTP ' + res.status);
        log('Tai khoan ' + account.email + ' het quota. Tu dong chuyen sang tai khoan tiep theo trong pool...');
        continue;
      }
    }

    return res;
  }
}

async function listModels() {
  if (modelsCache && Date.now() - modelsAt < MODEL_TTL) return modelsCache;
  const { token } = await ensureAccessToken();
  const r = await fetch(ENDPOINTS.daily + '/v1internal:fetchAvailableModels', {
    method: 'POST', headers: headers(token.access_token), body: '{}',
  });
  if (!r.ok) throw new Error('fetchAvailableModels ' + r.status);
  const data = await r.json();
  const out = [];
  for (const [id, m] of Object.entries(data.models || {})) {
    if (nonChat.test(id) || !m.displayName) continue;
    out.push({
      id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: m.apiProvider || 'antigravity',
      display_name: m.displayName,
      context_window: m.maxTokens || undefined,
      quota_remaining: m.quotaInfo?.remainingFraction,
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  modelsCache = out; modelsAt = Date.now();
  return out;
}

function textFromContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((p) => p.type === 'text').map((p) => p.text).join('');
  return String(content);
}

function partsFromContent(content) {
  if (content == null) return [];
  if (typeof content === 'string') return content ? [{ text: content }] : [];
  const parts = [];
  for (const p of content) {
    if (p.type === 'text' && p.text) parts.push({ text: p.text });
    else if (p.type === 'image_url' && p.image_url?.url) {
      const m = /^data:([^;]+);base64,(.*)$/s.exec(p.image_url.url);
      if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
      else parts.push({ text: '[image: ' + p.image_url.url + ']' });
    }
  }
  return parts;
}

function toGemini(messages) {
  const system = [];
  const contents = [];
  const callNames = new Map();

  const push = (role, parts) => {
    if (!parts.length) return;
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  };

  for (const msg of messages) {
    if (msg.role === 'system' || msg.role === 'developer') {
      system.push(textFromContent(msg.content));
      continue;
    }
    if (msg.role === 'user') { push('user', partsFromContent(msg.content)); continue; }
    if (msg.role === 'assistant') {
      const parts = [];
      const text = textFromContent(msg.content);
      if (text) parts.push({ text });
      for (const tc of msg.tool_calls || []) {
        let args = {};
        try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { /* keep {} */ }
        if (tc.id) callNames.set(tc.id, tc.function?.name);
        const { id, sig } = splitToolId(tc.id || '');
        const fc = { name: tc.function?.name, args, id };
        parts.push(sig ? { thoughtSignature: sig, functionCall: fc } : { functionCall: fc });
      }
      push('model', parts);
      continue;
    }
    if (msg.role === 'tool') {
      const name = callNames.get(msg.tool_call_id) || msg.name || 'tool';
      const raw = textFromContent(msg.content);
      let parsed; try { parsed = JSON.parse(raw); } catch { parsed = { result: raw }; }
      const response = parsed && parsed.result !== undefined ? parsed : { result: parsed };
      push('user', [{ functionResponse: { name, response } }]);
    }
  }
  if (!contents.length) contents.push({ role: 'user', parts: [{ text: system.join('\n') || ' ' }] });
  return {
    systemInstruction: system.length ? { parts: [{ text: system.join('\n\n') }] } : undefined,
    contents,
  };
}

function toGeminiTools(tools) {
  if (!Array.isArray(tools) || !tools.length) return undefined;
  const decls = [];
  for (const t of tools) {
    const fn = t.function || t;
    if (!fn?.name) continue;
    decls.push({
      name: fn.name,
      description: fn.description || '',
      parameters: fn.parameters || { type: 'object', properties: {} },
    });
  }
  return decls.length ? [{ functionDeclarations: decls }] : undefined;
}

function finishReason(fr, hasTools) {
  if (hasTools) return 'tool_calls';
  switch (fr) {
    case 'MAX_TOKENS': return 'length';
    case 'SAFETY': case 'RECITATION': case 'BLOCKLIST': case 'PROHIBITED_CONTENT': return 'content_filter';
    default: return 'stop';
  }
}

function usage(u) {
  if (!u) return undefined;
  return {
    prompt_tokens: u.promptTokenCount || 0,
    completion_tokens: u.candidatesTokenCount || 0,
    total_tokens: u.totalTokenCount || (u.promptTokenCount || 0) + (u.candidatesTokenCount || 0),
  };
}

function extract(candidate) {
  const parts = candidate?.content?.parts || [];
  let text = '';
  const calls = [];
  for (const p of parts) {
    if (p.thought) continue;
    if (typeof p.text === 'string') text += p.text;
    if (p.functionCall) calls.push({ ...p.functionCall, sig: p.thoughtSignature, id: p.functionCall.id });
  }
  return { text, calls, finish: candidate?.finishReason };
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function err(res, status, message, type = 'upstream_error') {
  send(res, status, { error: { message, type, code: status } });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 60 * 1024 * 1024) { reject(new Error('body quá lớn')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('JSON không hợp lệ')); }
    });
    req.on('error', reject);
  });
}

async function chat(req, res, body) {
  const messages = body.messages || [];
  const model = body.model;
  if (!model) return err(res, 400, 'model là bắt buộc', 'invalid_request_error');

  const { systemInstruction, contents } = toGemini(messages);
  const request = { contents };
  if (systemInstruction) request.systemInstruction = systemInstruction;
  const tools = toGeminiTools(body.tools);
  if (tools) request.tools = tools;
  const gc = {};
  if (body.temperature != null) gc.temperature = body.temperature;
  if (body.top_p != null) gc.topP = body.top_p;
  if (body.max_tokens != null) gc.maxOutputTokens = body.max_tokens;
  else if (body.max_completion_tokens != null) gc.maxOutputTokens = body.max_completion_tokens;
  if (Object.keys(gc).length) request.generationConfig = gc;

  const payload = { model, request };
  const id = 'chatcmpl-' + crypto.randomBytes(12).toString('hex');
  const created = Math.floor(Date.now() / 1000);
  log('chat', model, body.stream ? 'stream' : 'sync', messages.length + ' msgs');

  if (!body.stream) {
    const r = await upstream('/v1internal:generateContent', payload);
    const raw = await r.text();
    if (!r.ok) return err(res, r.status, raw.slice(0, 800));
    let j; try { j = JSON.parse(raw); } catch { return err(res, 502, 'upstream JSON lỗi'); }
    const resp = j.response || j;
    const cand = resp.candidates?.[0];
    const { text, calls, finish } = extract(cand);
    const tool_calls = calls.map((c) => ({
      id: toolId(c),
      type: 'function',
      function: { name: c.name, arguments: JSON.stringify(c.args || {}) },
    }));
    return send(res, 200, {
      id, object: 'chat.completion', created, model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text || (tool_calls.length ? null : ''), ...(tool_calls.length ? { tool_calls } : {}) },
        finish_reason: finishReason(finish, tool_calls.length > 0),
      }],
      usage: usage(resp.usageMetadata),
    });
  }

  const r = await upstream('/v1internal:streamGenerateContent?alt=sse', payload, { stream: true });
  if (!r.ok) { const t = await r.text(); return err(res, r.status, t.slice(0, 800)); }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const write = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');
  const base = { id, object: 'chat.completion.chunk', created, model };
  write({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });

  let buf = '';
  let finish = 'STOP';
  let toolIndex = 0;
  const toolCalls = [];
  let lastUsage;

  const handle = (data) => {
    let j; try { j = JSON.parse(data); } catch { return; }
    const resp = j.response || j;
    if (resp.usageMetadata) lastUsage = resp.usageMetadata;
    const cand = resp.candidates?.[0];
    if (!cand) return;
    if (cand.finishReason) finish = cand.finishReason;
    for (const part of cand.content?.parts || []) {
      if (part.thought) continue;
      if (typeof part.text === 'string' && part.text) {
        write({ ...base, choices: [{ index: 0, delta: { content: part.text }, finish_reason: null }] });
      }
      if (part.functionCall) {
        const idx = toolIndex++;
        const call = {
          id: toolId({ ...part.functionCall, sig: part.thoughtSignature }),
          type: 'function',
          function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args || {}) },
        };
        toolCalls.push(call);
        write({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: idx, ...call }] }, finish_reason: null }] });
      }
    }
  };

  const decoder = new TextDecoder();
  let closed = false;
  req.on('close', () => { closed = true; });
  try {
    for await (const chunk of r.body) {
      if (closed) break;
      buf += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        handle(data);
      }
    }
  } catch (e) {
    log('stream lỗi', e.message);
  }
  write({
    ...base,
    choices: [{ index: 0, delta: {}, finish_reason: finishReason(finish, toolCalls.length > 0) }],
    ...(lastUsage ? { usage: usage(lastUsage) } : {}),
  });
  res.write('data: [DONE]\n\n');
  res.end();
}

export function createServer() {
  return http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
        const pool = loadPool();
        return send(res, 200, {
          ok: true,
          service: 'agy-proxy',
          credential: !!loadCredential(),
          accounts_count: pool.accounts.length,
          active_account: pool.activeEmail,
          models_cached: !!modelsCache,
        });
      }
      if (req.method === 'GET' && url.pathname === '/v1/models') {
        return send(res, 200, { object: 'list', data: await listModels() });
      }
      if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
        return await chat(req, res, await readBody(req));
      }
      err(res, 404, 'not found', 'invalid_request_error');
    } catch (e) {
      log('lỗi', e.message);
      if (!res.headersSent) err(res, e.code === 'NO_CREDENTIAL' || e.code === 'NO_REFRESH_TOKEN' ? 401 : 500, e.message);
      else res.end();
    }
  });
}

export function startProxy({ port = Number(process.env.AGY_PORT || 8787), host = process.env.AGY_HOST || '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        log('cổng ' + port + ' đang bận — có thể proxy đã chạy. Kiểm tra: curl http://127.0.0.1:' + port + '/health');
      }
      reject(e);
    });
    server.listen(port, host, () => {
      const cred = loadCredential();
      log('v' + '1.0.0' + ' — http://' + host + ':' + port + '/v1');
      log('account:', cred?.email || '(chưa đăng nhập)');
      resolve(server);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startProxy().catch((e) => { console.error('[agy]', e.message); process.exit(1); });
}
