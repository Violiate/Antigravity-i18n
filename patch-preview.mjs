import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { patch } from './lib/patch.mjs';
import { ROOT_DIR, LOCALES_DIR, getSupportedLocaleCodes } from './lib/env.mjs';

const args = process.argv.slice(2);
const defaultInput = path.join(ROOT_DIR, 'out', 'capture', 'files', 'main.js');
const supportedCodes = getSupportedLocaleCodes().filter(c => c !== 'en');

function resolveLocalePath(arg) {
  if (!arg) return path.join(LOCALES_DIR, 'zh-CN.json');
  if (fs.existsSync(arg) && arg.endsWith('.json')) return path.resolve(arg);
  const candidate = path.join(LOCALES_DIR, arg.endsWith('.json') ? arg : `${arg}.json`);
  if (fs.existsSync(candidate)) return candidate;
  return null;
}

let input = defaultInput;
let localeArg = 'zh-CN';
let destination = path.join(ROOT_DIR, 'out', 'preview');

if (args.length === 1) {
  if (args[0] === 'all' || resolveLocalePath(args[0])) {
    localeArg = args[0];
  } else {
    input = args[0];
  }
} else if (args.length >= 2) {
  input = args[0];
  localeArg = args[1];
  if (args[2]) destination = args[2];
}

if (!fs.existsSync(input)) {
  throw new Error(
    `未找到待预览的原始 bundle 文件：${input}\n` +
    `请先运行探测脚本捕获 main.js，或指定一个现有的 JS bundle 路径：\n` +
    `  node patch-preview.mjs <bundle.js> [语言代码]`
  );
}

const source = fs.readFileSync(input, 'utf8');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

if (localeArg === 'all') {
  for (const code of supportedCodes) {
    const dictPath = resolveLocalePath(code);
    if (!dictPath) continue;
    const dictionary = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
    const result = patch(source, dictionary);
    console.log(`[${code.padEnd(5)}] 词条数: ${Object.keys(dictionary).length}, 替换处数: ${result.changes.length}, 语法校验: 通过`);
  }
  process.exit(0);
}

const localePath = resolveLocalePath(localeArg);
if (!localePath) {
  throw new Error(`未找到语言词库 "${localeArg}"。可选语言: ${supportedCodes.join(', ')} 或 all`);
}

const dictionary = JSON.parse(fs.readFileSync(localePath, 'utf8'));
const target = path.resolve(destination, 'main.js');
if (target === path.resolve(input)) throw new Error('预览输出不能覆盖输入文件');

const result = patch(source, dictionary);
fs.mkdirSync(destination, { recursive: true });
fs.writeFileSync(target, result.code);
fs.writeFileSync(path.join(destination, 'patch-report.json'), JSON.stringify({
  input: path.resolve(input),
  locale: localePath,
  inputSha256: hash(source),
  outputSha256: hash(result.code),
  replacements: result.changes.length,
  changes: result.changes,
}, null, 2));
console.log(`已生成离线预览 (${path.basename(localePath, '.json')})，替换 ${result.changes.length} 处，语法校验通过：${target}`);
