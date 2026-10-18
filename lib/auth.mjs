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
export function poolPath() {
  return path.join(homeDir(), 'accounts.json');
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
  return {
    email: obj.email || raw.email || 'unknown',
    token,
    auth_method: raw.auth_method || 'consumer',
    cooldownUntil: obj.cooldownUntil || 0,
    cooldownReason: obj.cooldownReason || '',
  };
}

function loadSingleFile() {
  const local = credentialPath();
  if (fs.existsSync(local)) {
    try {
      const c = normalize(JSON.parse(fs.readFileSync(local, 'utf8')));
      if (c) return { ...c, source: 'local', path: local };
    } catch { /* ignore */ }
  }
  if (process.env.AGY_CREDENTIAL) return null;
  const dsh = dshCredentialPath();
  if (fs.existsSync(dsh)) {
    try {
      const c = normalize(JSON.parse(fs.readFileSync(dsh, 'utf8')));
      if (c) return { ...c, source: 'dsh-import', path: dsh };
    } catch { /* ignore */ }
  }
  return null;
}

export function loadPool() {
  const p = poolPath();
  if (fs.existsSync(p)) {
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (Array.isArray(data.accounts)) {
        return {
          version: 1,
          activeEmail: data.activeEmail || data.accounts[0]?.email || null,
          accounts: data.accounts.map(normalize).filter(Boolean),
        };
      }
    } catch { /* ignore */ }
  }

  // Seed pool from single credential if pool doesn't exist yet
  const single = loadSingleFile();
  const pool = {
    version: 1,
    activeEmail: single?.email || null,
    accounts: single ? [{ ...single, addedAt: Date.now() }] : [],
  };
  if (single) savePool(pool);
  return pool;
}

export function savePool(pool) {
  const p = poolPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(pool, null, 2), { mode: 0o600 });
  try { fs.chmodSync(p, 0o600); } catch { /* windows */ }
}

export function saveAccount(account) {
  const pool = loadPool();
  const email = account.email || 'primary';
  const existingIdx = pool.accounts.findIndex(
    (a) => a.email && a.email.toLowerCase() === email.toLowerCase()
  );

  const entry = {
    email,
    auth_method: account.auth_method || 'consumer',
    token: account.token,
    cooldownUntil: 0,
    cooldownReason: '',
    updatedAt: Date.now(),
    addedAt: existingIdx >= 0 ? pool.accounts[existingIdx].addedAt : Date.now(),
  };

  if (existingIdx >= 0) {
    pool.accounts[existingIdx] = { ...pool.accounts[existingIdx], ...entry };
  } else {
    pool.accounts.push(entry);
  }
  pool.activeEmail = email;
  savePool(pool);

  // Sync to primary credential.json for backward compatibility
  saveSingleCredential(entry);
  return pool;
}

export function removeAccount(email) {
  const pool = loadPool();
  const prevCount = pool.accounts.length;
  pool.accounts = pool.accounts.filter(
    (a) => a.email && a.email.toLowerCase() !== email.toLowerCase()
  );
  if (pool.activeEmail && pool.activeEmail.toLowerCase() === email.toLowerCase()) {
    pool.activeEmail = pool.accounts[0]?.email || null;
  }
  savePool(pool);
  return prevCount !== pool.accounts.length;
}

export function switchActiveAccount(email) {
  const pool = loadPool();
  const found = pool.accounts.find(
    (a) => a.email && a.email.toLowerCase() === email.toLowerCase()
  );
  if (!found) return false;
  pool.activeEmail = found.email;
  savePool(pool);
  saveSingleCredential(found);
  return true;
}

export function markCooldown(email, durationMs = 15 * 60 * 1000, reason = '429 / quota limit') {
  const pool = loadPool();
  const acc = pool.accounts.find(
    (a) => a.email && a.email.toLowerCase() === email.toLowerCase()
  );
  if (acc) {
    acc.cooldownUntil = Date.now() + durationMs;
    acc.cooldownReason = reason;
    savePool(pool);
    console.error('[agy] Tai khoan ' + email + ' bi gioi han (' + reason + '). Tam dung ' + Math.round(durationMs / 60000) + ' phut.');
  }
}

export function clearCooldown(email) {
  const pool = loadPool();
  const acc = pool.accounts.find(
    (a) => a.email && a.email.toLowerCase() === email.toLowerCase()
  );
  if (acc) {
    acc.cooldownUntil = 0;
    acc.cooldownReason = '';
    savePool(pool);
  }
}

function saveSingleCredential(cred) {
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
}

export async function refreshAccount(account) {
  if (!account.token?.refresh_token) {
    const e = new Error('Tai khoan ' + account.email + ' khong co refresh_token - chay: pnpm login');
    e.code = 'NO_REFRESH_TOKEN';
    throw e;
  }
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: account.token.refresh_token,
    grant_type: 'refresh_token',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error('Refresh token that bai cho ' + account.email + ' (' + r.status + '): ' + (j.error_description || j.error || 'unknown'));
    e.code = 'REFRESH_FAILED';
    throw e;
  }
  account.token = {
    access_token: j.access_token,
    token_type: j.token_type || 'Bearer',
    refresh_token: j.refresh_token || account.token.refresh_token,
    expiry: new Date(Date.now() + (j.expires_in || 3600) * 1000).toISOString(),
  };

  // Save back to pool
  const pool = loadPool();
  const idx = pool.accounts.findIndex((a) => a.email.toLowerCase() === account.email.toLowerCase());
  if (idx >= 0) pool.accounts[idx] = account;
  savePool(pool);

  // Sync to primary credential if active
  if (pool.activeEmail && pool.activeEmail.toLowerCase() === account.email.toLowerCase()) {
    saveSingleCredential(account);
  }
  return account;
}

export async function getNextAccount(excludeEmails = []) {
  const pool = loadPool();
  if (!pool.accounts.length) {
    const e = new Error('Chua co tai khoan nao trong pool - chay: pnpm login');
    e.code = 'NO_CREDENTIAL';
    throw e;
  }

  const now = Date.now();
  const available = pool.accounts.filter(
    (a) => (!a.cooldownUntil || a.cooldownUntil <= now) && !excludeEmails.includes(a.email)
  );

  if (available.length === 0) {
    const sorted = [...pool.accounts].sort((a, b) => (a.cooldownUntil || 0) - (b.cooldownUntil || 0));
    const nextFree = sorted[0];
    const waitSec = Math.max(1, Math.round(((nextFree?.cooldownUntil || now) - now) / 1000));
    const err = new Error(
      'Tat ca ' + pool.accounts.length + ' tai khoan deu dang het quota. Tai khoan ' + nextFree?.email + ' se mo lai sau ' + waitSec + ' giay.'
    );
    err.code = 'ALL_ACCOUNTS_IN_COOLDOWN';
    err.retryAfterSec = waitSec;
    throw err;
  }

  // Prefer activeEmail if available, otherwise first available
  let chosen = available.find((a) => a.email === pool.activeEmail) || available[0];

  // Ensure access token is fresh
  const exp = chosen.token?.expiry ? Date.parse(chosen.token.expiry) : 0;
  if (!chosen.token.access_token || !Number.isFinite(exp) || exp < Date.now() + 60_000) {
    chosen = await refreshAccount(chosen);
  }

  return chosen;
}

// Backward-compatible exports
export function loadCredential() {
  const pool = loadPool();
  return pool.accounts.find((a) => a.email === pool.activeEmail) || pool.accounts[0] || null;
}
export function saveCredential(cred) {
  saveAccount(cred);
  return credentialPath();
}
export async function refresh(cred) {
  return await refreshAccount(cred);
}
export async function ensureAccessToken() {
  const acc = await getNextAccount();
  return acc;
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
  throw new Error('loadCodeAssist that bai: ' + last);
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
  throw new Error('fetchAvailableModels that bai: ' + last);
}
