
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { CLIENT_ID, CLIENT_SECRET, SCOPES, REDIRECT_URI, saveCredential } from './lib/auth.mjs';

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
  const spec = process.platform === 'win32'
    ? ['cmd.exe', ['/c', 'start', '', url]]
    : process.platform === 'darwin'
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
  if (!r.ok) throw new Error('Đổi code thất bại (' + r.status + '): ' + (j.error_description || j.error || 'unknown'));
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
        '<p>Đóng tab này và quay lại cửa sổ dsh-agy.</p></body>';

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page('Đăng nhập thất bại', String(error)));
        return finish(new Error('OAuth error: ' + error));
      }
      if (!code || gotState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page('Phản hồi không hợp lệ', 'Thiếu code hoặc state không khớp.'));
        return finish(new Error('OAuth state/code không hợp lệ'));
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
        const file = saveCredential(cred);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page('Đăng nhập thành công', (email || 'Google account') + ' · đã lưu credential'));
        finish(null, { ...cred, source: 'login', path: file });
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page('Lỗi đổi token', e.message));
        finish(e);
      }
    });

    const timer = setTimeout(() => finish(new Error('Hết thời gian đăng nhập (5 phút)')), timeoutMs);
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        finish(new Error('Cổng 51121 đang bị chiếm — đóng tiến trình đang dùng cổng này rồi thử lại.'));
      } else finish(e);
    });
    server.listen(PORT, '127.0.0.1', () => {
      console.log('[agy] Mở trình duyệt để đăng nhập Google (Antigravity)...');
      console.log('[agy] Nếu trình duyệt không tự mở, dán URL này:\n\n' + url + '\n');
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
  login({ open: !args.includes('--no-browser') })
    .then((cred) => {
      console.log('[agy] Đã lưu credential cho:', cred.email || '(không rõ email)');
      console.log('[agy] File:', cred.path);
    })
    .catch((e) => {
      console.error('[agy] Lỗi:', e.message);
      process.exit(1);
    });
}
