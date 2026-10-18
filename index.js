import { createServer } from './proxy.mjs';
import { loadCredential } from './lib/auth.mjs';

export const name = 'dsh-agy';

export function apply(ctx, config = {}) {
  const port = Number(config.port || process.env.AGY_PORT || 8787);
  const host = config.host || process.env.AGY_HOST || '127.0.0.1';
  const logger = ctx?.logger ? ctx.logger('dsh-agy') : console;

  let server = null;

  async function init() {
    try {
      const health = await fetch('http://' + host + ':' + port + '/health', {
        signal: AbortSignal.timeout(1000)
      }).then(r => r.json()).catch(() => null);

      if (health?.service === 'agy-proxy') {
        if (logger.info) logger.info('[dsh-agy] Proxy already running on port ' + port);
        else console.log('[dsh-agy] Proxy already running on port ' + port);
        return;
      }

      server = createServer();
      server.listen(port, host, () => {
        const cred = loadCredential();
        const msg = '[dsh-agy] In-process proxy started at http://' + host + ':' + port + '/v1 (' + (cred?.email || 'no account') + ')';
        if (logger.info) logger.info(msg);
        else console.log(msg);
      });

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          const msg = '[dsh-agy] Port ' + port + ' in use, attaching to existing instance.';
          if (logger.warn) logger.warn(msg);
          else console.warn(msg);
        } else {
          if (logger.error) logger.error('[dsh-agy] Error:', err);
          else console.error('[dsh-agy] Error:', err);
        }
      });
    } catch (err) {
      if (logger.error) logger.error('[dsh-agy] Init error:', err);
      else console.error('[dsh-agy] Init error:', err);
    }
  }

  if (ctx && typeof ctx.on === 'function') {
    ctx.on('dispose', async () => {
      if (server) {
        if (logger.info) logger.info('[dsh-agy] Disposing in-process proxy...');
        server.close();
        server = null;
      }
    });
  }

  init();
}

export default { name, apply };
