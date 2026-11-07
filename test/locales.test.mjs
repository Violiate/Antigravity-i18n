import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '../lib/scan.mjs';
import { LOCALES_DIR, getSupportedLocaleCodes, parseCliArgs } from '../lib/env.mjs';

test('词库键一致、无重复键、保留占位符', () => {
  const base = Object.keys(JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, 'zh-CN.json')))).sort();
  const tokens = s => (s.match(/\{\w+\}|%\d*\$?[sdif]/g) || []).sort();
  for (const code of getSupportedLocaleCodes().filter(c => c !== 'en')) {
    const text = fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), 'utf8');
    const dictionary = JSON.parse(text);
    const props = parse(`(${text})`).body[0].expression.properties;
    assert.equal(props.length, Object.keys(dictionary).length, `${code}: 重复 key`);
    assert.deepEqual(Object.keys(dictionary).sort(), base, code);
    for (const [source, translated] of Object.entries(dictionary)) {
      assert.ok(translated.trim(), `${code}: ${source}`);
      assert.deepEqual(tokens(translated), tokens(source), `${code}: ${source}`);
    }
  }
});

test('缺少路径参数时明确报错', () => {
  assert.throws(() => parseCliArgs(['install', '--dir']), /缺少/);
});
