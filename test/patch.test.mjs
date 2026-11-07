import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { patch } from '../lib/patch.mjs';
import { scan } from '../lib/scan.mjs';
import {
  LOCALES_DIR,
  parseCliArgs,
  getSupportedLanguages,
  getSupportedLocaleCodes,
} from '../lib/env.mjs';

test('翻译 React 显示位置，保留逻辑、未审核属性和 JSX key', () => {
  const source = `x === "Settings"; const data={description:"Settings"}; React.createElement("button",{title:"Settings"},"Settings"); jsx("div",{children:"Settings"},"Settings"); React.createElement(Custom,{label:"Settings"},"Settings");`;
  const result = patch(source, {Settings:'设置'});
  assert.equal(result.changes.length, 4);
  assert.ok(result.code.includes('x === "Settings"'));
  assert.ok(result.code.includes('description:"Settings"'));
  assert.ok(result.code.includes('jsx("div",{children:"设置"},"Settings")'));
  assert.ok(result.code.includes('React.createElement(Custom,{label:"Settings"},"设置")'));
  assert.equal(scan(`jsx("div",{},"Settings")`).length, 0);
});

test('三元、数组和转义译文保持语法；重复运行不再改动', () => {
  const source = 'jsx("button",{children:[ok?"Save":"Cancel",`Close`]})';
  const dictionary = {Save:'保存"\n',Cancel:'取消',Close:'关闭'};
  const first = patch(source, dictionary);
  assert.equal(first.changes.length, 3);
  assert.equal(patch(first.code, dictionary).changes.length, 0);
  assert.equal(patch('React.createElement("div",{},"Unknown")', dictionary).changes.length, 0);
});

test('支持设置定义项、快捷键命令项、选项解析器与逻辑表达式子节点，同时跳过状态枚举', () => {
  const source = [
    'const cmd = { id: "settings.open", label: "Open Settings", icon: "settings" };',
    'const cursorState = { active: true, phase: "thinking", label: "Thinking" };',
    'const setting = { isProviderSetting: true, screen: "General", label: "Enter to Send", description: "Send messages with the keyboard\'s Enter key instead of starting a new line.", resolveOptionToString: x => { switch(x) { default: return "Queue"; } } };',
    'React.createElement("span", { className: "muted" }, value || "Not set");',
  ].join('\n');
  const dict = {
    'Open Settings': '打开设置',
    'Thinking': '思考中',
    'Enter to Send': '按 Enter 发送',
    "Send messages with the keyboard's Enter key instead of starting a new line.": '按键盘上的 Enter 键直接发送消息，而不是换行。',
    'Queue': '排队',
    'Not set': '未设置',
  };
  const result = patch(source, dict);
  assert.equal(result.changes.length, 5);
  assert.ok(result.code.includes('label: "打开设置"'));
  assert.ok(result.code.includes('phase: "thinking", label: "Thinking"'));
  assert.ok(result.code.includes('label: "按 Enter 发送"'));
  assert.ok(result.code.includes('return "排队"'));
  assert.ok(result.code.includes('value || "未设置"'));
});

test('CLI 参数解析与多语言配置发现正常工作', () => {
  const parsed = parseCliArgs(['install', 'ja', '--dir', 'D:\\Apps\\Antigravity']);
  assert.deepEqual(parsed.positional, ['install', 'ja']);
  assert.equal(parsed.customDir, 'D:\\Apps\\Antigravity');

  const codes = getSupportedLocaleCodes();
  assert.ok(codes.includes('en'));
  assert.ok(codes.includes('zh-CN'));
  assert.ok(codes.length >= 2);
});

test('所有已安装的语言包均为合法 JSON 且可通过 AST 语法补丁校验', () => {
  const languages = getSupportedLanguages().filter(l => l.code !== 'en');
  const sampleCode = `React.createElement("button", { title: "Settings", placeholder: "Search..." }, "Save");`;
  for (const lang of languages) {
    const filePath = path.join(LOCALES_DIR, `${lang.code}.json`);
    assert.ok(fs.existsSync(filePath), `Missing locale file: ${filePath}`);
    const dict = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const keys = Object.keys(dict);
    assert.ok(keys.length >= 2000, `Locale ${lang.code} should have >= 2000 keys, got ${keys.length}`);
    for (const [k, v] of Object.entries(dict)) {
      assert.equal(typeof v, 'string', `Locale ${lang.code} key ${k} has non-string value`);
      assert.ok(v.length > 0, `Locale ${lang.code} key ${k} has empty translation`);
    }
    const patched = patch(sampleCode, dict);
    assert.ok(patched.code.length > 0);
  }
});
