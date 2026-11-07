#!/usr/bin/env node
// 用法: node extract.mjs <app.asar 路径> [输出目录]
// 只读：不修改 app.asar。输出 strings.json（按原文去重）和 report.txt（按文件统计）。
import fs from 'node:fs';
import path from 'node:path';
import * as asar from '@electron/asar';
import { scan } from './lib/scan.mjs';
import { ROOT_DIR, resolveResourcesDir } from './lib/env.mjs';

const asarPath = process.argv[2] || path.join(resolveResourcesDir(), 'app.asar');
const outDir = process.argv[3] || path.join(ROOT_DIR, 'out');
if (!asarPath || !fs.existsSync(asarPath)) {
  console.error('用法: node extract.mjs [app.asar 路径] [输出目录]');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const files = asar.listPackage(asarPath, { isPack: false })
  .map((f) => f.replace(/^[\\/]/, '').replace(/\\/g, '/'))
  .filter((f) => /\.(m?js|cjs)$/.test(f) && !f.includes('node_modules/'));

const strings = new Map(); // value -> { count, contexts:Set, files:Set }
const report = [];

for (const f of files) {
  let code;
  try { code = asar.extractFile(asarPath, path.normalize(f)).toString('utf8'); }
  catch (e) { report.push(`SKIP(read) ${f}: ${e.message}`); continue; }
  let hits;
  try { hits = scan(code); }
  catch (e) { report.push(`SKIP(parse) ${f} (${(code.length / 1024).toFixed(0)} KB): ${e.message}`); continue; }
  report.push(`${String(hits.length).padStart(6)}  ${(code.length / 1024).toFixed(0).padStart(6)} KB  ${f}`);
  for (const h of hits) {
    const e = strings.get(h.value) || { count: 0, contexts: new Set(), files: new Set() };
    e.count++; e.contexts.add(h.context); e.files.add(f);
    strings.set(h.value, e);
  }
}

const out = [...strings.entries()]
  .sort((a, b) => b[1].count - a[1].count)
  .map(([value, e]) => ({ value, count: e.count, contexts: [...e.contexts], files: [...e.files] }));

fs.writeFileSync(path.join(outDir, 'strings.json'), JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(outDir, 'report.txt'),
  `asar: ${asarPath}\nJS 文件: ${files.length}\n唯一候选文案: ${out.length}\n\n` +
  report.sort().reverse().join('\n'));

console.log(`扫描 ${files.length} 个 JS 文件，得到 ${out.length} 条唯一候选文案`);
console.log(`→ ${path.join(outDir, 'strings.json')}\n→ ${path.join(outDir, 'report.txt')}`);
