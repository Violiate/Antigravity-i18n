import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as asar from '@electron/asar';
import { copyTree } from './lib/copy.mjs';
import {
  ROOT_DIR,
  parseCliArgs,
  resolveResourcesDir,
  isAntigravityRunning,
  getSupportedLocaleCodes,
} from './lib/env.mjs';

const { Pickle } = await import(
  pathToFileURL(path.join(ROOT_DIR, 'node_modules', '@electron', 'asar', 'lib', 'pickle.js')).href
);

const { positional, customDir } = parseCliArgs();
const action = positional[0] || 'install';
const requestedLocale = positional[1];
if (requestedLocale && !getSupportedLocaleCodes().includes(requestedLocale)) throw new Error(`不支持的语言：${requestedLocale}`);
const resources = resolveResourcesDir(customDir);
const archive = path.join(resources, 'app.asar');
const runtime = path.join(resources, 'agy-i18n');
const statePath = path.join(runtime, 'install-state.json');
const configPath = path.join(runtime, 'config.json');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');

if (!fs.existsSync(archive)) {
  throw new Error(
    `未找到 Antigravity 安装包：${archive}\n` +
    `请确认已安装 Antigravity，或使用 --dir 指定安装目录，例如：\n` +
    `  node install.mjs ${action} --dir "D:\\Programs\\Antigravity"`
  );
}

const current = fs.readFileSync(archive);
let state;
try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}

if (action === 'status') {
  const isPatched = Boolean(state && hash(current) === state.patchedHash);
  let currentLocale = 'zh-CN';
  try { currentLocale = JSON.parse(fs.readFileSync(configPath, 'utf8')).locale; } catch {}
  console.log(JSON.stringify({
    resourcesDir: resources,
    installed: isPatched,
    locale: currentLocale,
    availableLocales: getSupportedLocaleCodes(),
    installedAt: state?.installedAt || null,
  }, null, 2));
  process.exit(0);
}

if (action === 'restore') {
  if (isAntigravityRunning(resources)) {
    throw new Error('请先完全退出 Antigravity；还原器不会强制关闭正在运行的会话');
  }
  if (!state || hash(current) !== state.patchedHash) {
    throw new Error('当前程序已更新或不属于此安装记录，不覆盖它');
  }
  const original = fs.readFileSync(state.backup);
  if (hash(original) !== state.originalHash) throw new Error('备份哈希不符');
  const tmp = archive + '.i18n-tmp';
  fs.writeFileSync(tmp, original);
  fs.renameSync(tmp, archive);
  console.log(`已恢复原始 app.asar：${archive}`);
  process.exit(0);
}

if (action !== 'install') {
  throw new Error('用法: node install.mjs [install|restore|status] [--dir <Antigravity安装目录>]');
}

const alreadyPatched = Boolean(state && hash(current) === state.patchedHash);
if (isAntigravityRunning(resources)) {
  throw new Error('请先完全退出 Antigravity；安装器不会强制关闭正在运行的会话');
}

// Validate compatibility before writing runtime files or configuration.
const raw = asar.getRawHeader(archive);
const entry = raw.header.files?.dist?.files?.['main.js'];
if (!entry || entry.unpacked || entry.link) throw new Error('不支持的客户端入口结构，未修改客户端');
const originalMain = asar.extractFile(archive, 'dist/main.js').toString();
if (!alreadyPatched && originalMain.includes('agy-i18n/loader.cjs')) throw new Error('发现未知安装补丁，请先恢复原始客户端');

fs.mkdirSync(runtime, { recursive: true });
for (const folder of ['lib', 'locales']) {
  copyTree(path.join(ROOT_DIR, folder), path.join(runtime, folder));
}
fs.copyFileSync(path.join(ROOT_DIR, 'runtime', 'loader.cjs'), path.join(runtime, 'loader.cjs'));
for (const dependency of ['acorn', 'acorn-walk', 'magic-string', '@jridgewell/sourcemap-codec']) {
  copyTree(
    path.join(ROOT_DIR, 'node_modules', dependency),
    path.join(runtime, 'node_modules', dependency),
  );
}

const supportedLocales = getSupportedLocaleCodes();
const defaultLocale = requestedLocale && supportedLocales.includes(requestedLocale) ? requestedLocale : 'zh-CN';
if (!fs.existsSync(configPath)) {
  fs.writeFileSync(configPath, JSON.stringify({ locale: defaultLocale }, null, 2));
} else if (requestedLocale && supportedLocales.includes(requestedLocale)) {
  const existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  fs.writeFileSync(configPath, JSON.stringify({ ...existingConfig, locale: requestedLocale }, null, 2));
}

if (alreadyPatched) {
  console.log(`加载器和多语言词库已同步至 ${runtime}（入口补丁已存在）`);
  process.exit(0);
}


const prefix = `try { require(require('node:path').join(process.resourcesPath, 'agy-i18n/loader.cjs')); } catch (e) { console.error('[agy-i18n]', e); }\n`;
const replacement = Buffer.from(prefix + originalMain);
const data = current.subarray(8 + raw.headerSize);
// Append the one changed file; preserve every other packed byte, link and unpacked entry.
entry.offset = String(data.length);
entry.size = replacement.length;
const blockSize = 4194304;
entry.integrity = { algorithm: 'SHA256', hash: hash(replacement), blockSize, blocks: [] };
for (let i = 0; i < replacement.length; i += blockSize) {
  entry.integrity.blocks.push(hash(replacement.subarray(i, i + blockSize)));
}

const header = Pickle.createEmpty();
header.writeString(JSON.stringify(raw.header));
const headerBuffer = header.toBuffer();
const size = Pickle.createEmpty();
size.writeUInt32(headerBuffer.length);
const patched = Buffer.concat([size.toBuffer(), headerBuffer, data, replacement]);
const backup = path.join(runtime, `original-${hash(current)}.asar`);
if (!fs.existsSync(backup)) fs.writeFileSync(backup, current, { flag: 'wx' });
if (hash(fs.readFileSync(backup)) !== hash(current)) throw new Error('已有备份校验失败，停止安装');
const temp = archive + '.i18n-tmp';
fs.writeFileSync(temp, patched);
asar.uncache(temp);
if (!asar.extractFile(temp, 'dist/main.js').equals(replacement)) {
  throw new Error('生成的 ASAR 验证失败');
}
const newState = {
  originalHash: hash(current),
  patchedHash: hash(patched),
  backup,
  installedAt: new Date().toISOString(),
};
fs.writeFileSync(statePath, JSON.stringify(newState, null, 2));
fs.renameSync(temp, archive);
console.log(`已安装成功（目录：${resources}），正常启动 Antigravity 即可。还原命令：node install.mjs restore`);
