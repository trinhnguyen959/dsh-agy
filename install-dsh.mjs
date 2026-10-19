import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dshHome } from './lib/auth.mjs';

const PROVIDER = 'antigravity';

// Tim tat ca cac profile cua DSH (desktop, web, etc.)
function profiles(only) {
  const dir = path.join(dshHome(), 'profiles');
  if (!fs.existsSync(dir)) return [];
  const all = fs.readdirSync(dir)
    .map((name) => path.join(dir, name, 'cordis.patch.yml'))
    .filter((p) => fs.existsSync(p));
  if (only) return all.filter((p) => path.basename(path.dirname(p)) === only);
  return all; // Patch tat ca profile tim thay
}

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

function ensurePackageLink(profileDir) {
  const nm = path.join(profileDir, 'node_modules');
  fs.mkdirSync(nm, { recursive: true });
  const link = path.join(nm, 'dsh-agy');
  if (fs.existsSync(link)) return 'link da co';
  try {
    fs.symlinkSync(projectRoot, link, 'junction');
    return 'da tao junction dsh-agy';
  } catch {
    return 'khong tao duoc junction';
  }
}

function backup(file) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const to = file + '.bak-' + stamp;
  fs.copyFileSync(file, to);
  return to;
}

function injectProvider(text, baseURL) {
  const providerConfig = [
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
  ].join('\n');

  // Case 1: Da co route antigravity
  if (new RegExp('^\\s+' + PROVIDER + ':', 'm').test(text)) {
    return null;
  }

  // Case 2: Co llm-pi-ai voi providers: {}
  if (/^\s+providers:\s*\{\s*\}/m.test(text)) {
    return text.replace(/^\s+providers:\s*\{\s*\}/m, providerConfig);
  }

  // Case 3: Co llm-pi-ai voi providers:
  if (/^\s+providers:\s*$/m.test(text)) {
    const lines = providerConfig.split('\n').slice(1).join('\n');
    return text.replace(/^\s+providers:\s*$/m, '    providers:\n' + lines);
  }

  // Case 4: Chua co llm-pi-ai -> them ca block
  const fullBlock = [
    '',
    '# dsh-agy: Antigravity quota qua proxy local (OpenAI-compatible)',
    '- id: llm-pi-ai',
    '  name: "@deepseek-ai/dsh-llm-pi-ai"',
    '  config:',
    providerConfig,
    '',
  ].join('\n');

  return (text.endsWith('\n') ? text : text + '\n') + fullBlock;
}

function injectPlugin(text, projectRoot, port = 8787) {
  const pluginFile = path.join(projectRoot, 'index.js').replace(/\\/g, '/');
  if (/id:\s*agy-plugin/.test(text)) {
    return null;
  }
  const pluginBlock = [
    '',
    '# dsh-agy: Plugin tu dong chay in-process cung DSH (tu bat khi mo DSH)',
    '- insert:',
    '    - id: agy-plugin',
    '      name: "' + pluginFile + '"',
    '      config:',
    '        port: ' + port,
    '',
  ].join('\n');
  return (text.endsWith('\n') ? text : text + '\n') + pluginBlock;
}

function removeStartup() {
  if (process.platform !== 'win32') return null;
  const appData = process.env.APPDATA;
  if (!appData) return null;
  const file = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'dsh-agy-proxy.vbs');
  if (fs.existsSync(file)) {
    try {
      fs.unlinkSync(file);
      return 'da don dep file auto-start cu: ' + file;
    } catch { /* ignore */ }
  }
  return null;
}

function ensureStartup(projectRoot) {
  if (process.platform !== 'win32') return 'bo qua startup (khong phai Windows)';
  const appData = process.env.APPDATA;
  if (!appData) return 'bo qua startup (khong co APPDATA)';
  const dir = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  if (!fs.existsSync(dir)) return 'bo qua startup (khong thay thu muc Startup)';
  const file = path.join(dir, 'dsh-agy-proxy.vbs');
  const cmdPath = projectRoot.replace(/\\/g, '\\\\');
  const vbs = [
    'Set sh = CreateObject("WScript.Shell")',
    'sh.Run "cmd /c cd /d ""' + projectRoot + '"" && node start.mjs", 0, False',
    '',
  ].join('\r\n');
  fs.writeFileSync(file, vbs, 'utf8');
  return 'da cai auto-start: ' + file;
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
  port = Number(process.env.AGY_PORT || 8787),
  asPlugin = true,
  profile = process.env.AGY_DSH_PROFILE || '',
  dryRun = false,
} = {}) {
  const files = profiles(profile);
  const out = [];
  if (!files.length) {
    out.push('Khong thay ~/.dsh/profiles — bo qua cau hinh DSH.');
    return out;
  }
  const links = [];
  if (asPlugin) {
    for (const file of files) {
      links.push(path.basename(path.dirname(file)) + ': ' + ensurePackageLink(path.dirname(file)));
    }
  }

  for (const file of files) {
    const profName = path.basename(path.dirname(file));
    let text = fs.readFileSync(file, 'utf8');
    let changed = false;

    const updatedProvider = injectProvider(text, baseURL);
    if (updatedProvider !== null) {
      text = updatedProvider;
      changed = true;
    }

    if (asPlugin) {
      const updatedPlugin = injectPlugin(text, projectRoot, port);
      if (updatedPlugin !== null) {
        text = updatedPlugin;
        changed = true;
      }
    }

    if (!changed) {
      out.push(profName + ': route & plugin da co san');
      continue;
    }

    if (dryRun) {
      out.push(profName + ': se cap nhat route & plugin (dry-run)');
      continue;
    }

    const copy = backup(file);
    fs.writeFileSync(file, text, 'utf8');
    out.push(profName + ': da cap nhat route & plugin (backup ' + path.basename(copy) + ')');
  }

  out.push(...links);
  if (!dryRun) out.push(ensureRef());
  if (!dryRun) {
    if (asPlugin) {
      const rm = removeStartup();
      if (rm) out.push(rm);
    } else {
      out.push(ensureStartup(projectRoot));
    }
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  const asPlugin = !process.argv.includes('--standalone');
  const pi = process.argv.indexOf('--profile');
  const profile = pi >= 0 ? process.argv[pi + 1] : '';
  for (const line of install({ dryRun, asPlugin, profile })) console.log('[agy]', line);
  console.log('[agy] Khoi dong lai DSH de nhan provider & plugin moi.');
}
