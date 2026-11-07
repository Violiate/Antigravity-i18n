#!/usr/bin/env node
// 用法: node analyze-capture.mjs [抓包目录=out/capture]
// 对探针抓到的前端资源做离线分析（只读）：
//   1) 用 lib/scan.mjs 统计每个 JS 里的候选界面文案
//   2) 检查 CSP / SRI(integrity) / sourcemap 等会影响“加载时替换”方案的因素
//   3) 列出 bundle 内文件名字符串线索（不等于实际加载依赖）
import fs from 'node:fs';
import path from 'node:path';
import { scan } from './lib/scan.mjs';

const dir = process.argv[2] || 'out/capture';
const manifestPath = path.join(dir, 'manifest.jsonl');
if (!fs.existsSync(manifestPath)) {
  console.error(`找不到 ${manifestPath}，请先运行 probe\\run-probe.ps1`);
  process.exit(1);
}

const records = fs.readFileSync(manifestPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const saved = records.filter((r) => r.file);
const lines = [];
const P = (s = '') => lines.push(s);

let meta = {};
try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch {}
P(`App ${meta.appVersion ?? '?'} / Electron ${meta.electron ?? '?'} / Chrome ${meta.chrome ?? '?'}`);
P(`本地请求记录: ${records.length}，已保存文件: ${saved.length}，下载失败: ${records.filter((r) => r.error || (r.refetchStatus && r.refetchStatus >= 400)).length}`);
P();

// ---- 1. 安全策略 ----
P('== CSP / SRI / 其他 ==');
const csps = new Set(records.map((r) => r.csp).filter(Boolean));
P(`CSP 响应头: ${csps.size ? '' : '无'}`);
for (const c of csps) P(`  ${c}`);
for (const r of records.filter((r) => r.cspReportOnly)) P(`  (report-only) ${r.cspReportOnly}`);
for (const r of saved.filter((r) => /\.html?$/i.test(r.file))) {
  const html = fs.readFileSync(path.join(dir, 'files', r.file), 'utf8');
  const meta = html.match(/<meta[^>]+http-equiv=["']?content-security-policy[^>]*>/gi) || [];
  const integ = html.match(/integrity=["'][^"']+["']/gi) || [];
  const scripts = [...html.matchAll(/<script[^>]*src=["']([^"']+)["']/gi)].map((m) => m[1]);
  P(`HTML ${r.file}: meta-CSP ${meta.length} 处, integrity ${integ.length} 处, 外链脚本 ${scripts.length} 个`);
  for (const m of meta) P(`  ${m}`);
  for (const s of scripts) P(`  script: ${s}`);
}
const headerNames = new Set(records.flatMap((r) => r.reqHeaderNames || []));
P(`静态资源请求头: ${[...headerNames].join(', ') || '(无)'}`);
P();

// ---- 2. 文案扫描 ----
P('== JS 文案扫描 ==');
const strings = new Map();
const perFile = [];
const jsFiles = saved.filter((r) => /\.m?js$/i.test(r.file));
const referenced = new Set();
for (const r of jsFiles) {
  const code = fs.readFileSync(path.join(dir, 'files', r.file), 'utf8');
  for (const m of code.matchAll(/["'`]((?:\.{0,2}\/)?[\w\-./]*?[\w-]+\.m?js)["'`]/g)) referenced.add(path.posix.basename(m[1]));
  const hasMap = /\/\/[#@] sourceMappingURL=/.test(code.slice(-500));
  let hits;
  try { hits = scan(code); }
  catch (e) { perFile.push(`SKIP(parse) ${r.file} (${(code.length / 1024).toFixed(0)} KB): ${e.message}`); continue; }
  perFile.push(`${String(hits.length).padStart(6)}  ${(code.length / 1024).toFixed(0).padStart(6)} KB  ${hasMap ? 'map ' : '    '}${r.file}`);
  for (const h of hits) {
    const e = strings.get(h.value) || { count: 0, contexts: new Set(), files: new Set() };
    e.count++; e.contexts.add(h.context); e.files.add(r.file);
    strings.set(h.value, e);
  }
}
perFile.sort().reverse().forEach((l) => P(l));
P(`唯一候选文案: ${strings.size}`);
P();

// ---- 3. 未加载的 chunk ----
const loaded = new Set(jsFiles.map((r) => path.posix.basename(r.file)));
const missing = [...referenced].filter((n) => !loaded.has(n));
P(`== bundle 内未对应已抓取文件的文件名字符串（含图标映射等误报，不是加载依赖清单）: ${missing.length} ==`);
missing.slice(0, 80).forEach((n) => P(`  ${n}`));
P();

// ---- 4. 失败与非静态请求 ----
P('== 下载失败 ==');
records.filter((r) => r.error || (r.refetchStatus && r.refetchStatus >= 400))
  .forEach((r) => P(`  ${r.refetchStatus ?? ''} ${r.url} ${r.error ?? ''}`));
P('== 其他本地请求（未下载，仅记录路径） ==');
records.filter((r) => r.skipped).slice(0, 60).forEach((r) => P(`  ${r.type} ${r.status} ${r.url}`));

const out = [...strings.entries()]
  .sort((a, b) => b[1].count - a[1].count)
  .map(([value, e]) => ({ value, count: e.count, contexts: [...e.contexts], files: [...e.files] }));
fs.writeFileSync(path.join(dir, 'strings.json'), JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(dir, 'report.txt'), lines.join('\n'));
console.log(lines.slice(0, 40).join('\n'));
console.log(`\n→ ${path.join(dir, 'report.txt')}\n→ ${path.join(dir, 'strings.json')}`);
