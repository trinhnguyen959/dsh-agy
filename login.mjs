import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, exec } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  CLIENT_ID,
  CLIENT_SECRET,
  SCOPES,
  REDIRECT_URI,
  saveAccount,
  loadPool,
  removeAccount,
  switchActiveAccount,
} from './lib/auth.mjs';

const PORT = 51121;

export function pkce() {
  const verifier = crypto.randomBytes(64).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function authUrl(challenge, state) {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', CLIENT_ID);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', REDIRECT_URI);
  u.searchParams.set('scope', SCOPES.join(' '));
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', state);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  return u.toString();
}

function openBrowser(url) {
  if (process.platform === 'win32') {
    try {
      exec('start "" "' + url + '"', (err) => {
        if (err) {
          try { exec('rundll32 url.dll,FileProtocolHandler "' + url + '"'); } catch {}
        }
      });
      return true;
    } catch {
      try {
        exec('rundll32 url.dll,FileProtocolHandler "' + url + '"');
        return true;
      } catch {
        return false;
      }
    }
  }
  const spec = process.platform === 'darwin'
    ? ['open', [url]]
    : ['xdg-open', [url]];
  try {
    spawn(spec[0], spec[1], { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch { return false; }
}

async function exchange(code, verifier) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Doi code that bai (' + r.status + '): ' + (j.error_description || j.error || 'unknown'));
  return j;
}

async function emailOf(accessToken) {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
    if (!r.ok) return undefined;
    return (await r.json()).email;
  } catch { return undefined; }
}

export function login({ open = true, timeoutMs = 300_000 } = {}) {
  return new Promise((resolve, reject) => {
    const { verifier, challenge } = pkce();
    const state = crypto.randomBytes(24).toString('base64url');
    const url = authUrl(challenge, state);
    let settled = false;

    const finish = (err, cred) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      err ? reject(err) : resolve(cred);
    };

    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://localhost');
      if (u.pathname !== '/oauth-callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      }
      const code = u.searchParams.get('code');
      const error = u.searchParams.get('error');
      const gotState = u.searchParams.get('state');

      const page = (title, detail) => '<!doctype html><meta charset="utf-8"><title>' + title + '</title>' +
        '<body style="font-family:system-ui;padding:40px"><h2>' + title + '</h2><p>' + detail + '</p>' +
        '<p>Dong tab nay va quay lai ung dung dsh-agy.</p></body>';

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page('Dang nhap that bai', String(error)));
        return finish(new Error('OAuth error: ' + error));
      }
      if (!code || gotState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page('Phan hoi khong hop le', 'Thieu code hoac state khong khop.'));
        return finish(new Error('OAuth state/code khong hop le'));
      }
      try {
        const tok = await exchange(code, verifier);
        const email = await emailOf(tok.access_token);
        const cred = {
          email,
          auth_method: 'consumer',
          token: {
            access_token: tok.access_token,
            token_type: tok.token_type || 'Bearer',
            refresh_token: tok.refresh_token,
            expiry: new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString(),
          },
        };
        const pool = saveAccount(cred);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page('Dang nhap thanh cong', (email || 'Google account') + ' - Da them vao Account Pool (' + pool.accounts.length + ' tai khoan)'));
        finish(null, { ...cred, source: 'login', pool });
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page('Loi doi token', e.message));
        finish(e);
      }
    });

    const timer = setTimeout(() => finish(new Error('Het thoi gian dang nhap (5 phut)')), timeoutMs);
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        finish(new Error('Cong 51121 dang bi chiem - dong tien trinh dang dung cong nay roi thu lai.'));
      } else finish(e);
    });
    server.listen(PORT, '127.0.0.1', () => {
      console.log('[agy] Mo trinh duyet de dang nhap Google (Antigravity)...');
      console.log('[agy] Neu trinh duyet khong tu mo, dan URL nay:\n\n' + url + '\n');
      if (open) openBrowser(url);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes('--print-url')) {
    const { challenge } = pkce();
    console.log(authUrl(challenge, crypto.randomBytes(12).toString('base64url')));
    process.exit(0);
  }

  if (args.includes('--list')) {
    const pool = loadPool();
    console.log('=== Danh sach tai khoan trong Pool (' + pool.accounts.length + ' tai khoan) ===');
    pool.accounts.forEach((acc, idx) => {
      const isActive = acc.email === pool.activeEmail ? ' [Dang hoat dong]' : '';
      const inCooldown = acc.cooldownUntil && acc.cooldownUntil > Date.now()
        ? ' (Tam dung con ' + Math.round((acc.cooldownUntil - Date.now()) / 1000) + 's - ' + (acc.cooldownReason || '') + ')'
        : ' (San sang)';
      console.log('  ' + (idx + 1) + '. ' + acc.email + isActive + inCooldown);
    });
    process.exit(0);
  }

  const removeIdx = args.indexOf('--remove');
  if (removeIdx >= 0 && args[removeIdx + 1]) {
    const target = args[removeIdx + 1];
    const ok = removeAccount(target);
    if (ok) console.log('[agy] Da xoa tai khoan ' + target + ' khoi pool.');
    else console.log('[agy] Khong tim thay tai khoan ' + target + ' trong pool.');
    process.exit(0);
  }

  const switchIdx = args.indexOf('--switch');
  if (switchIdx >= 0 && args[switchIdx + 1]) {
    const target = args[switchIdx + 1];
    const ok = switchActiveAccount(target);
    if (ok) console.log('[agy] Da chuyen tai khoan hoat dong sang: ' + target);
    else console.log('[agy] Khong tim thay tai khoan ' + target + ' trong pool.');
    process.exit(0);
  }

  login({ open: !args.includes('--no-browser') })
    .then((res) => {
      console.log('========================================================');
      console.log('[agy] Da luu tai khoan thanh cong: ' + (res.email || '(khong ro email)'));
      console.log('[agy] Tong so tai khoan trong Pool: ' + (res.pool?.accounts?.length || 1));
      console.log('========================================================');
    })
    .catch((e) => {
      console.error('[agy] Loi:', e.message);
      process.exit(1);
    });
}
