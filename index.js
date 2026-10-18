import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const name = 'dsh-agy';

function logLine(msg) {
  const line = new Date().toISOString() + ' ' + msg;
  try {
    const dir = path.join(os.homedir(), '.agy-dsh');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'plugin.log'), line + '\n');
  } catch { /* ignore */ }
  try { console.log('[dsh-agy] ' + msg); } catch { /* ignore */ }
}

export function apply(ctx, config = {}) {
  logLine('apply() called');
  const port = Number(config.port || process.env.AGY_PORT || 8787);
  const host = config.host || process.env.AGY_HOST || '127.0.0.1';
  let server = null;

  const dispose = () => {
    if (!server) return;
    try { server.close(); } catch { /* ignore */ }
    server = null;
    logLine('proxy closed');
  };

  try {
    if (ctx && typeof ctx.on === 'function') ctx.on('dispose', dispose);
  } catch (e) {
    logLine('dispose hook failed: ' + (e && e.message));
  }

  (async () => {
    try {
      logLine('importing proxy module');
      const mod = await import('./proxy.mjs');
      const auth = await import('./lib/auth.mjs');
      const cred = auth.loadCredential();
      logLine('credential: ' + (cred ? (cred.email || 'unknown') : 'NONE'));

      try {
        const r = await fetch('http://' + host + ':' + port + '/health', { signal: AbortSignal.timeout(1200) });
        const j = await r.json();
        if (j && j.service === 'agy-proxy') {
          logLine('proxy already listening on ' + port + ' — reuse');
          return;
        }
      } catch { /* not running */ }

      server = mod.createServer();
      server.on('error', (e) => logLine('server error: ' + (e && e.code) + ' ' + (e && e.message)));
      server.listen(port, host, () => logLine('listening on http://' + host + ':' + port + '/v1'));
    } catch (e) {
      logLine('init failed: ' + (e && e.stack ? e.stack : String(e)));
    }
  })();
}

export default { name, apply };
