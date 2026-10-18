import { loadPool, refreshAccount, loadProject, availableModels } from './lib/auth.mjs';

const pool = loadPool();
console.log('=== Antigravity Multi-Account Pool (' + pool.accounts.length + ' tai khoan) ===\n');

if (pool.accounts.length === 0) {
  console.log('Chua co tai khoan nao. Chay: pnpm login');
  process.exit(0);
}

for (let i = 0; i < pool.accounts.length; i++) {
  let acc = pool.accounts[i];
  const isActive = acc.email === pool.activeEmail ? ' [DANG HOAT DONG]' : '';
  const inCooldown = acc.cooldownUntil && acc.cooldownUntil > Date.now()
    ? ' [TAM DUNG con ' + Math.round((acc.cooldownUntil - Date.now()) / 1000) + 's - ' + (acc.cooldownReason || '') + ']'
    : ' [SAN SANG]';

  console.log('[' + (i + 1) + '] ' + acc.email + isActive + inCooldown);

  try {
    const exp = acc.token?.expiry ? Date.parse(acc.token.expiry) : 0;
    if (!acc.token?.access_token || !Number.isFinite(exp) || exp < Date.now() + 60_000) {
      acc = await refreshAccount(acc);
    }
    const { project, raw } = await loadProject(acc.token.access_token);
    const tier = raw.currentTier || {};
    console.log('    Tier   : ' + tier.id + ' - ' + tier.name);
    console.log('    Project: ' + (project || 'aicode-consumers'));

    const data = await availableModels(acc.token.access_token, project).catch(() => ({ models: {} }));
    const groups = new Map();
    for (const [id, m] of Object.entries(data.models || {})) {
      if (/^(tab_|chat_\d)/.test(id) || !m.displayName) continue;
      const g = m.apiProvider || 'unknown';
      const q = m.quotaInfo?.remainingFraction;
      if (q == null) continue;
      groups.set(g, Math.min(groups.get(g) ?? 1, q));
    }
    console.log('    Quota  :');
    for (const [g, q] of groups) {
      console.log('      ' + g.replace('API_PROVIDER_', '').padEnd(20) + (q * 100).toFixed(0) + '% remaining');
    }
  } catch (e) {
    console.log('    Loi kiem tra quota: ' + e.message);
  }
  console.log('');
}
