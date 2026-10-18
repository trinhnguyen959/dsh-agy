import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dshHome } from './lib/auth.mjs';

const PROVIDER = 'antigravity';

function profiles() {
  const dir = path.join(dshHome(), 'profiles');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((name) => path.join(dir, name, 'cordis.patch.yml'))
    .filter((p) => fs.existsSync(p));
}

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

function ensurePackageLink(profileDir) {
  const nm = path.join(profileDir, 'node_modules');
  fs.mkdirSync(nm, { recursive: true });
  const link = path.join(nm, 'dsh-agy');
  if (fs.existsSync(link)) return 'link da co';
  fs.symlinkSync(projectRoot, link, 'junction');
  return 'da tao junction dsh-agy';
}

function block(baseURL, asPlugin = true) {
  const lines = [''];
  if (asPlugin) {
    lines.push(
      '# dsh-agy: Plugin tu dong chay in-process cung DSH (khong can start.cmd)',
      '- id: agy-plugin',
      '  name: "dsh-agy"',
      '  config:',
      '    port: 8787',
      ''
    );
  }
  lines.push(
    '# dsh-agy: Antigravity quota qua proxy (OpenAI-compatible)',
    '- id: llm-pi-ai',
    '  name: "@deepseek-ai/dsh-llm-pi-ai"',
    '  config:',
    '    providers:',
    '      ' + PROVIDER + ':',
    '        displayName: Antigravity (local)',
    '        api: openai-completions',
    '        baseURL: ' + baseURL,
    '        apiKeyEnv: AGY_PROXY_KEY',
    '        defaultContextWindow: 1048576',
    '        defaultMaxTokens: 65536',
    '        models:',
    '          - id: gemini-3-flash',
    '            name: Gemini 3 Flash (AGY)',
    '            contextWindow: 1048576',
    '          - id: gemini-3.8-flash-high',
    '            name: Gemini 3.8 Flash High (AGY)',
    '            contextWindow: 1048576',
    '          - id: gemini-3.1-flash-lite',
    '            name: Gemini 3.1 Flash Lite (AGY)',
    '            contextWindow: 1048576',
    '          - id: claude-sonnet-4-6',
    '            name: Claude Sonnet 4.6 (AGY)',
    '            contextWindow: 200000',
    '          - id: claude-opus-4-6-thinking',
    '            name: Claude Opus 4.6 Thinking (AGY)',
    '            contextWindow: 200000',
    '          - id: gpt-oss-120b-medium',
    '            name: GPT-OSS 120B (AGY)',
    '            contextWindow: 131072',
    ''
  );
  return lines.join('\n');
}

function backup(file) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const to = file + '.bak-' + stamp;
  fs.copyFileSync(file, to);
  return to;
}

function ensureRef() {
  const file = path.join(dshHome(), '.credentials.yaml');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'version: 1\nrefs:\n  AGY_PROXY_KEY: local-proxy\n', 'utf8');
    return 'tao moi ~/.dsh/.credentials.yaml';
  }
  let text = fs.readFileSync(file, 'utf8');
  if (/^\s+AGY_PROXY_KEY:/m.test(text)) return 'AGY_PROXY_KEY da co';
  if (/^refs:\s*$/m.test(text)) {
    text = text.replace(/^refs:\s*$/m, 'refs:\n  AGY_PROXY_KEY: local-proxy');
  } else if (/^refs:\s*\{\s*\}\s*$/m.test(text)) {
    text = text.replace(/^refs:\s*\{\s*\}\s*$/m, 'refs:\n  AGY_PROXY_KEY: local-proxy');
  } else {
    if (!text.endsWith('\n')) text += '\n';
    text += 'refs:\n  AGY_PROXY_KEY: local-proxy\n';
  }
  backup(file);
  fs.writeFileSync(file, text, 'utf8');
  return 'da them AGY_PROXY_KEY vao .credentials.yaml';
}

export function install({
  baseURL = process.env.AGY_BASE_URL || ('http://127.0.0.1:' + (process.env.AGY_PORT || 8787) + '/v1'),
  asPlugin = false,
  dryRun = false,
} = {}) {
  const files = profiles();
  const out = [];
  if (!files.length) {
    out.push('Khong thay ~/.dsh/profiles — bo qua cau hinh DSH.');
    return out;
  }
  for (const file of files) {
    let text = fs.readFileSync(file, 'utf8');
    const hasRoute = /id:\s*llm-pi-ai/.test(text) && new RegExp('^\\s+' + PROVIDER + ':', 'm').test(text);
    const hasPlugin = /id:\s*agy-plugin/.test(text);

    if (hasRoute && (!asPlugin || hasPlugin)) {
      out.push(path.basename(path.dirname(file)) + ': route va plugin da co san');
      continue;
    }

    if (dryRun) {
      out.push(path.basename(path.dirname(file)) + ': se cap nhat (dry-run)');
      continue;
    }

    const copy = backup(file);
    if (!hasPlugin && asPlugin) {
      // Append plugin entry
      const pEntry = [
        '',
        '# dsh-agy: Plugin tu dong chay in-process cung DSH',
        '- id: agy-plugin',
        '  name: "dsh-agy"',
        '  config:',
        '    port: 8787',
        '',
      ].join('\n');
      text = text + pEntry;
    }
    if (!hasRoute) {
      text = text + block(baseURL, false);
    }
    fs.writeFileSync(file, text, 'utf8');
    out.push(path.basename(path.dirname(file)) + ': da cap nhat (backup ' + path.basename(copy) + ')');
  }
  if (!dryRun) out.push(ensureRef());
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  const asPlugin = process.argv.includes('--plugin'); // experimental: opt-in only
  for (const line of install({ dryRun, asPlugin })) console.log('[agy]', line);
  console.log('[agy] Khoi dong lai DSH de nạp plugin moi.');
}
