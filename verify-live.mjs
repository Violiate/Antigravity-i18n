// Uses the client's existing DevTools endpoint. Does not enable new listeners.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ROOT_DIR,
  parseCliArgs,
  resolveResourcesDir,
  getSupportedLocaleCodes,
} from './lib/env.mjs';

function resolveDevToolsPortFile() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Antigravity', 'DevToolsActivePort');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Antigravity', 'DevToolsActivePort');
}

const { positional, customDir } = parseCliArgs();
const selected = positional[0];
const supportedCodes = getSupportedLocaleCodes();

const portFile = resolveDevToolsPortFile();
if (!fs.existsSync(portFile)) {
  throw new Error(`未找到正在运行的 Antigravity DevTools 端口文件：${portFile}`);
}
const port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(t => /^https:\/\/127\.0\.0\.1:\d+\//.test(t.url));
if (!target) throw new Error('未找到 Antigravity 本地界面');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  const entry = pending.get(message.id);
  if (entry) {
    pending.delete(message.id);
    message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
  }
};
async function send(method, params = {}) {
  const requestId = ++id;
  return Promise.race([
    new Promise((resolve, reject) => { pending.set(requestId, { resolve, reject }); ws.send(JSON.stringify({ id: requestId, method, params })); }),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('CDP timeout')), 15000); timer.unref(); }),
  ]);
}
try {
  if (selected) {
    if (!supportedCodes.includes(selected)) {
      throw new Error(`无效语言 "${selected}"。可选值: ${supportedCodes.join(', ')}`);
    }
    const change = await send('Runtime.evaluate', {
      expression: `(() => { const s=document.getElementById('agy-i18n-control')?.shadowRoot?.querySelector('select');if(!s) throw new Error('语言控件未找到');s.value=${JSON.stringify(selected)};s.dispatchEvent(new Event('change'));return true;})()`,
      returnByValue: true,
    });
    if (change.exceptionDetails) throw new Error('语言控件切换失败');
    await new Promise(resolve => setTimeout(resolve, 8000));
  }
  const result = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({selected:document.getElementById("agy-i18n-control")?.shadowRoot?.querySelector("select")?.value,text:document.body.innerText,buttons:[...document.querySelectorAll("button")].map(b=>({text:b.innerText,title:b.title}))})',
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error('页面读取失败');
  const state = JSON.parse(result.result.value);
  const resources = resolveResourcesDir(customDir);
  const config = JSON.parse(fs.readFileSync(path.join(resources, 'agy-i18n', 'config.json'), 'utf8'));
  const locale = config.locale;
  if (selected && selected !== locale) throw new Error(`语言切换未生效：请求 ${selected}，实际 ${locale}`);
  if (state.selected !== locale) throw new Error('刷新后的语言控件与配置不一致');
  const expectedSettings = locale === 'en' ? 'Settings' : JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'locales', `${locale}.json`), 'utf8')).Settings;
  if (!state.buttons.some(b => b.text.trim() === expectedSettings)) throw new Error(`未找到已翻译的设置按钮: ${expectedSettings}`);
  const outDir = path.join(ROOT_DIR, 'out', 'verification');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${locale}.json`), JSON.stringify({ locale, ...state }, null, 2));
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  const screenshotPath = path.join(outDir, `${locale}.png`);
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  console.log(JSON.stringify({ locale, screenshot: screenshotPath }));
} finally {
  ws.close();
}
