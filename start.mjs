import { loadCredential } from './lib/auth.mjs';
import { login } from './login.mjs';
import { install } from './install-dsh.mjs';
import { startProxy } from './proxy.mjs';

const args = process.argv.slice(2);
const port = Number(process.env.AGY_PORT || 8787);

async function alreadyRunning() {
  try {
    const r = await fetch('http://127.0.0.1:' + port + '/health', { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return false;
    const j = await r.json();
    return j?.service === 'agy-proxy';
  } catch { return false; }
}

if (await alreadyRunning()) {
  console.log('================================================================');
  console.log('[agy] Proxy ĐANG CHẠY RỒI tại http://127.0.0.1:' + port + '/v1');
  console.log('[agy] DSH hiện đang kết nối trực tiếp vào proxy này.');
  console.log('[agy] (Nếu muốn khởi động lại proxy, hãy chạy stop.cmd trước)');
  console.log('================================================================');
  process.exit(0);
}

let cred = loadCredential();
if (!cred) {
  console.log('[agy] Chưa có credential — cần đăng nhập Google một lần.');
  cred = await login({ open: true });
} else {
  console.log('[agy] Credential:', cred.email || '(không rõ email)', '· nguồn:', cred.source);
}

if (!args.includes('--no-dsh')) {
  try {
    const lines = install({ asPlugin: args.includes('--plugin') });
    for (const line of lines) console.log('[agy]', line);
  } catch (e) {
    console.warn('[agy] Bỏ qua cấu hình DSH:', e.message);
  }
}

await startProxy({ port });
console.log('[agy] Đang chạy lắng nghe tại port ' + port + '. Giữ cửa sổ này để proxy tiếp tục chạy.');
console.log('[agy] Nhấn Ctrl+C để dừng.');
