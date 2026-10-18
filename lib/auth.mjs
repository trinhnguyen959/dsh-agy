
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const _d = (a, k = 77) => a.map((c) => String.fromCharCode(c ^ k)).join('');
export const CLIENT_ID = _d([124,125,122,124,125,125,123,125,123,125,120,116,124,96,57,32,37,62,62,36,35,127,37,127,124,33,46,63,40,127,126,120,59,57,34,33,34,39,37,121,42,121,125,126,40,61,99,44,61,61,62,99,42,34,34,42,33,40,56,62,40,63,46,34,35,57,40,35,57,99,46,34,32]);
export const CLIENT_SECRET = _d([10,2,14,30,29,21,96,6,120,117,11,26,31,121,117,123,1,41,1,7,124,32,1,15,117,62,21,14,121,55,123,60,9,12,43]);
export const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
];
export const REDIRECT_URI = 'http://localhost:51121/oauth-callback';
export const ENDPOINTS = {
  daily: 'https://daily-cloudcode-pa.googleapis.com',
  prod: 'https://cloudcode-pa.googleapis.com',
};

export function homeDir() {
  return process.env.AGY_HOME ? path.resolve(process.env.AGY_HOME) : path.join(os.homedir(), '.agy-dsh');
}
export function credentialPath() {
  return process.env.AGY_CREDENTIAL ? path.resolve(process.env.AGY_CREDENTIAL) : path.join(homeDir(), 'credential.json');
}
export function dshHome() {
  return process.env.DSH_HOME ? path.resolve(process.env.DSH_HOME) : path.join(os.homedir(), '.dsh');
}
export function dshCredentialPath() {
  return path.join(dshHome(), 'agy-accounts', '.primary-credential.json');
}

export function headers(token, extra = {}) {
  return {
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Antigravity/2.24.0 Chrome/138.0.7204.235 Electron/37.3.1 Safari/537.36',
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': JSON.stringify({ ideType: 'ANTIGRAVITY', platform: 'WINDOWS', pluginType: 'GEMINI' }),
    ...extra,
  };
}

function normalize(obj) {
  if (!obj) return null;
  let raw = obj;
  if (typeof obj.raw === 'string') {
    try { raw = JSON.parse(obj.raw); } catch { return null; }
  }
  const token = raw.token || raw;
  if (!token || (!token.access_token && !token.refresh_token)) return null;
  return { email: obj.email || raw.email, token, auth_method: raw.auth_method || 'consumer' };
}

export function loadCredential() {
  const local = credentialPath();
  if (fs.existsSync(local)) {
    try {
      const c = normalize(JSON.parse(fs.readFileSync(local, 'utf8')));
      if (c) return { ...c, source: 'local', path: local };
    } catch { /* fall through */ }
  }
  if (process.env.AGY_CREDENTIAL) return null;
  const dsh = dshCredentialPath();
  if (fs.existsSync(dsh)) {
    try {
      const c = normalize(JSON.parse(fs.readFileSync(dsh, 'utf8')));
      if (c) {
        saveCredential(c);
        return { ...c, source: 'dsh-import', path: dsh };
      }
    } catch { /* ignore */ }
  }
  return null;
}

export function saveCredential(cred) {
  const p = credentialPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const data = {
    email: cred.email,
    auth_method: cred.auth_method || 'consumer',
    token: cred.token,
    savedAt: Date.now(),
  };
  fs.writeFileSync(p, JSON.stringify(data, null, 2), { mode: 0o600 });
  try { fs.chmodSync(p, 0o600); } catch { /* windows */ }
  return p;
}

export async function refresh(cred) {
  if (!cred.token?.refresh_token) {
    const e = new Error('Credential không có refresh_token — chạy: npm run login');
    e.code = 'NO_REFRESH_TOKEN';
    throw e;
  }
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: cred.token.refresh_token,
    grant_type: 'refresh_token',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error('Refresh token thất bại (' + r.status + '): ' + (j.error_description || j.error || 'unknown'));
    e.code = 'REFRESH_FAILED';
    throw e;
  }
  cred.token = {
    access_token: j.access_token,
    token_type: j.token_type || 'Bearer',
    refresh_token: j.refresh_token || cred.token.refresh_token,
    expiry: new Date(Date.now() + (j.expires_in || 3600) * 1000).toISOString(),
  };
  saveCredential(cred);
  return cred;
}

export async function ensureAccessToken() {
  let cred = loadCredential();
  if (!cred) {
    const e = new Error('Chưa có credential — chạy: npm run login (hoặc start.cmd)');
    e.code = 'NO_CREDENTIAL';
    throw e;
  }
  const exp = cred.token?.expiry ? Date.parse(cred.token.expiry) : 0;
  if (!cred.token.access_token || !Number.isFinite(exp) || exp < Date.now() + 60_000) {
    cred = await refresh(cred);
  }
  return cred;
}

export async function loadProject(token) {
  const body = { metadata: { ideType: 'ANTIGRAVITY', pluginType: 'GEMINI' } };
  let last = '';
  for (const base of [ENDPOINTS.prod, ENDPOINTS.daily]) {
    const r = await fetch(base + '/v1internal:loadCodeAssist', {
      method: 'POST', headers: headers(token), body: JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) { last = base + ' ' + r.status + ' ' + text.slice(0, 200); continue; }
    const j = JSON.parse(text);
    const p = j.cloudaicompanionProject;
    return { project: typeof p === 'string' ? p : p?.id, base, raw: j };
  }
  throw new Error('loadCodeAssist thất bại: ' + last);
}

export async function availableModels(token, project) {
  let last = '';
  for (const base of [ENDPOINTS.daily, ENDPOINTS.prod]) {
    const r = await fetch(base + '/v1internal:fetchAvailableModels', {
      method: 'POST', headers: headers(token), body: JSON.stringify(project ? { project } : {}),
    });
    if (!r.ok) { last = base + ' ' + r.status; continue; }
    return await r.json();
  }
  throw new Error('fetchAvailableModels thất bại: ' + last);
}
