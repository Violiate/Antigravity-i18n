import fs from 'node:fs';
import path from 'node:path';
import {
  parseCliArgs,
  resolveResourcesDir,
  getSupportedLanguages,
  getSupportedLocaleCodes,
} from './lib/env.mjs';

const { positional, customDir } = parseCliArgs();
const locale = positional[0];
const languages = getSupportedLanguages();
const codes = getSupportedLocaleCodes();

if (!locale || locale === 'list' || locale === '--list' || locale === '-l') {
  console.log('支持的语言列表 (Supported Languages):');
  for (const lang of languages) {
    console.log(`  ${lang.code.padEnd(8)} - ${lang.nativeName} (${lang.name})`);
  }
  console.log(`\n切换语言用法: node language.mjs <语言代码> [--dir <Antigravity安装目录>]`);
  process.exit(0);
}

if (!codes.includes(locale)) {
  throw new Error(
    `不支持的语言代码 "${locale}"。\n` +
    `可选值: ${codes.join(' | ')}\n` +
    `运行 node language.mjs list 查看详情。`
  );
}

const resources = resolveResourcesDir(customDir);
const config = path.join(resources, 'agy-i18n', 'config.json');
if (!fs.existsSync(config)) {
  throw new Error(`未找到配置文件：${config}\n请先运行 node install.mjs install`);
}

let currentConfig = {};
try { currentConfig = JSON.parse(fs.readFileSync(config, 'utf8')); } catch {}
fs.writeFileSync(config, JSON.stringify({ ...currentConfig, locale }, null, 2));
const selectedLang = languages.find(l => l.code === locale);
console.log(`语言已设为 ${locale} (${selectedLang?.nativeName || locale})，运行中的 Antigravity 界面将自动刷新。`);
