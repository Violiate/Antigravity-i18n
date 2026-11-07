import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ROOT_DIR } from '../lib/env.mjs';

if (process.platform !== 'win32') throw new Error('此构建脚本在 Windows 上运行');
const proxyIndex = process.argv.indexOf('--proxy');
const proxy = proxyIndex >= 0 ? process.argv[proxyIndex + 1] : undefined;
const version = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'))).version;
const nodeVersion = 'v22.23.4';
const nodeArchive = `node-${nodeVersion}-win-x64.zip`;
const expected = 'cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20';
const cache = path.join(ROOT_DIR, 'out/build-cache');
const dist = path.join(ROOT_DIR, 'dist');
const name = `agy-i18n-${version}-windows-x64`;
// A fresh stage prevents files from an earlier build entering a new release.
fs.mkdirSync(cache, { recursive: true });
fs.mkdirSync(dist, { recursive: true });
const staging = path.join(fs.mkdtempSync(path.join(cache, 'stage-')), name);
const app = path.join(staging, 'app');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.mkdirSync(cache, { recursive: true });
fs.mkdirSync(app, { recursive: true });
const archive = path.join(cache, nodeArchive);
if (!fs.existsSync(archive)) {
  const args = ['--fail', '--location', '--silent', '--show-error', '--max-time', '180'];
  if (proxy) args.push('--proxy', proxy);
  execFileSync('curl.exe', [...args, '--output', archive, `https://nodejs.org/dist/${nodeVersion}/${nodeArchive}`], { stdio: 'inherit' });
}
if (hash(archive) !== expected) throw new Error('官方 Node ZIP SHA-256 不符，停止构建');
function powershell(script, extra = {}) {
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { env: { ...process.env, ...extra }, stdio: 'inherit' });
}
powershell('Expand-Archive -LiteralPath $env:AGY_NODE_ZIP -DestinationPath $env:AGY_NODE_OUTPUT -Force', { AGY_NODE_ZIP: archive, AGY_NODE_OUTPUT: cache });
fs.mkdirSync(path.join(staging, 'runtime'), { recursive: true });
for (const file of ['node.exe', 'LICENSE']) fs.copyFileSync(path.join(cache, `node-${nodeVersion}-win-x64`, file), path.join(staging, 'runtime', file));
// Explicit allowlist: never include captures, user settings, client code or backups.
for (const entry of ['install.mjs', 'language.mjs', 'lib', 'locales', 'runtime', 'docs', 'package.json', 'package-lock.json', 'LICENSE', 'README.md', 'TESTING.md']) {
  fs.cpSync(path.join(ROOT_DIR, entry), path.join(app, entry), { recursive: true });
}
const lock = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package-lock.json')));
for (const entry of Object.keys(lock.packages).filter(p => p.startsWith('node_modules/'))) {
  fs.cpSync(path.join(ROOT_DIR, entry), path.join(app, entry), { recursive: true });
}
fs.mkdirSync(path.join(app, 'packaging'), { recursive: true });
fs.copyFileSync(path.join(ROOT_DIR, 'packaging/setup-runner.mjs'), path.join(app, 'packaging/setup-runner.mjs'));
// Windows PowerShell 5.1 needs a BOM for Chinese script literals.
fs.writeFileSync(path.join(app, 'packaging/Setup.ps1'), '\uFEFF' + fs.readFileSync(path.join(ROOT_DIR, 'packaging/Setup.ps1'), 'utf8').replace(/^\uFEFF/, ''));
fs.copyFileSync(path.join(ROOT_DIR, 'packaging/Setup.cmd'), path.join(staging, 'Setup.cmd'));
fs.writeFileSync(path.join(staging, 'START-HERE.txt'), '\uFEFF' + [
  'Antigravity i18n — Windows x64 离线安装包',
  '1. 将整个 ZIP 解压到一个文件夹，不要直接在压缩包中运行。',
  '2. 保存工作，完全退出 Antigravity（包括托盘）。',
  '3. 双击 Setup.cmd，确认目录、选择语言，点击“安装 / 更新”。',
  '4. 正常打开 Antigravity，在右下角切换语言。',
  '恢复原版：退出客户端，再打开 Setup.cmd，点击“还原原版”。',
  '客户端更新后翻译消失：退出客户端，再点击“安装 / 更新”。',
  '无需安装 Node.js/npm；安装过程不联网、不关闭你的会话。',
  '目前仅提供 Windows x64 包。无需默认以管理员身份运行；安装在受保护目录时可能需要相应写入权限。',
  '代理可选；不替其他用户预填本机代理地址。',
  '本工具尚未签名，Windows 可能显示未知发布者提示。',
  '',
  'Extract the whole ZIP, close Antigravity, double-click Setup.cmd, select a language and install.',
  'Node.js and dependencies are bundled. No npm or network connection is required.',
].join('\r\n'));
const files = [];
function walk(dir) { for (const item of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, item.name); if (item.isDirectory()) walk(full); else files.push({ path: path.relative(staging, full).replaceAll('\\', '/'), sha256: hash(full) }); } }
walk(staging);
fs.writeFileSync(path.join(staging, 'MANIFEST.json'), JSON.stringify({ version, platform: 'win32-x64', nodeVersion, nodeArchiveSha256: expected, files }, null, 2));
const zip = path.join(dist, `${name}.zip`);
powershell('Compress-Archive -LiteralPath $env:AGY_STAGE -DestinationPath $env:AGY_ZIP -Force', { AGY_STAGE: staging, AGY_ZIP: zip });
fs.writeFileSync(zip + '.sha256', `${hash(zip)}  ${path.basename(zip)}\n`);
console.log(`已构建 ${zip} (${(fs.statSync(zip).size / 1048576).toFixed(1)} MiB)`);
