
import { ensureAccessToken, loadProject, availableModels } from './lib/auth.mjs';

const cred = await ensureAccessToken();
const { project, raw } = await loadProject(cred.token.access_token);
const tier = raw.currentTier || {};
console.log('account :', cred.email || '(không rõ)');
console.log('tier    :', tier.id, '-', tier.name);
console.log('project :', project);

const data = await availableModels(cred.token.access_token, project).catch(() => ({ models: {} }));
const groups = new Map();
for (const [id, m] of Object.entries(data.models || {})) {
  if (/^(tab_|chat_\d)/.test(id) || !m.displayName) continue;
  const g = m.apiProvider || 'unknown';
  const q = m.quotaInfo?.remainingFraction;
  if (q == null) continue;
  groups.set(g, Math.min(groups.get(g) ?? 1, q));
}
console.log('quota   :');
for (const [g, q] of groups) console.log('  ' + g.replace('API_PROVIDER_', '').padEnd(20), (q * 100).toFixed(0) + '% remaining');

const rows = Object.entries(data.models || {})
  .filter(([id, m]) => m.displayName && !/^(tab_|chat_\d)/.test(id))
  .map(([id, m]) => [id, m.displayName, ((m.quotaInfo?.remainingFraction ?? 1) * 100).toFixed(0) + '%']);
console.log('models  :', rows.length, 'chat models');
for (const [id, name, q] of rows) console.log('  ' + id.padEnd(28), name.padEnd(30), q);
