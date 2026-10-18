import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const name = 'dsh-agy';

function writeLog(level, msg) {
  const line = new Date().toISOString() + ' [' + level + '] ' + msg;
  try {
    const dir = path.join(os.homedir(), '.agy-dsh');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'plugin.log'), line + '\n');
  } catch { /* ignore */ }
  return line;
}

export function apply(ctx, config = {}) {
  const port = Number(config.port || process.env.AGY_PORT || 8787);
  const host = config.host || process.env.AGY_HOST || '127.0.0.1';
  const logger = (ctx && ctx.logger) || null;

  const emit = (level, msg) => {
    const line = writeLog(level, msg);
    try {
      if (logger && typeof logger[level] === 'function') logger[level]('[dsh-agy] ' + msg);
      else console.log(line);
    } catch { /* ignore */ }
  };

  emit('info', 'apply() called (port ' + port + ')');

  let server = null;
  const dispose = () => {
    if (!server) return;
    try { server.close(); } catch { /* ignore */ }
    server = null;
    emit('info', 'proxy closed');
  };
  try {
    if (ctx && typeof ctx.on === 'function') ctx.on('dispose', dispose);
  } catch { /* ignore */ }

  (async () => {
    try {
      const mod = await import('./proxy.mjs');
      const auth = await import('./lib/auth.mjs');
      const cred = auth.loadCredential();
      emit('info', 'credential: ' + (cred ? (cred.email || 'unknown') : 'NONE'));

      try {
        const r = await fetch('http://' + host + ':' + port + '/health', { signal: AbortSignal.timeout(1200) });
        const j = await r.json();
        if (j && j.service === 'agy-proxy') {
          emit('info', 'proxy already listening on ' + port + ' - reuse');
          return;
        }
      } catch { /* not running */ }

      server = mod.createServer();
      server.on('error', (e) => emit('error', 'server error ' + (e && e.code)));
      server.listen(port, host, () => emit('info', 'listening on http://' + host + ':' + port + '/v1'));
    } catch (e) {
      emit('error', 'init failed: ' + (e && e.message));
    }
  })();
}

export default { name, apply };
