'use strict';
// Installed before the application's main module. No external Inspector listener.
const { app, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const root = __dirname;
const localesDir = path.join(root, 'locales');
const configPath = path.join(root, 'config.json');
const logPath = path.join(root, 'runtime.log');

const log = (event, extra = {}) => {
  try { fs.appendFileSync(logPath, JSON.stringify({ time: new Date().toISOString(), event, ...extra }) + '\n'); } catch {}
};

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { return {}; }
}

function writeConfig(updates) {
  const next = { ...readConfig(), ...updates };
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2));
  return next;
}

function loadLanguageEntries() {
  const entries = [];
  const seen = new Set();
  const manifestPath = path.join(localesDir, 'languages.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const item of manifest) {
      if (item && item.code && (item.code === 'en' || fs.existsSync(path.join(localesDir, `${item.code}.json`)))) {
        entries.push([item.code, item.nativeName || item.label || item.name || item.code]);
        seen.add(item.code);
      }
    }
  } catch {}
  if (!seen.has('en')) {
    entries.unshift(['en', 'English']);
    seen.add('en');
  }
  try {
    for (const file of fs.readdirSync(localesDir)) {
      if (!file.endsWith('.json') || file === 'languages.json') continue;
      const code = file.slice(0, -5);
      if (!seen.has(code)) {
        entries.push([code, code]);
        seen.add(code);
      }
    }
  } catch {}
  return entries;
}

const languageEntries = loadLanguageEntries();
const locales = languageEntries.map(([code]) => code);

let locale = readConfig().locale || 'zh-CN';
if (!locales.includes(locale)) locale = 'en';

// Optional user-configured network proxy; loopback services always stay direct.
try {
  const proxy = readConfig().proxy;
  if (proxy) {
    const url = new URL(proxy);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported proxy scheme');
    app.commandLine.appendSwitch('proxy-server', proxy);
    app.commandLine.appendSwitch('proxy-bypass-list', '<local>;127.0.0.1;localhost;[::1]');
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) process.env[key] = proxy;
    for (const key of ['NO_PROXY', 'no_proxy']) process.env[key] = 'localhost,127.0.0.1,::1';
    log('proxy-configured', { proxy });
  }
} catch (e) { log('proxy-error', { message: e.message }); }

const windows = new Set();
const cache = new Map();

function selectLocale(id) {
  if (!locales.includes(id) || locale === id) return;
  locale = id;
  log('language-selected', { locale });
  const submenu = Menu.getApplicationMenu()?.getMenuItemById('agy-i18n-language')?.submenu;
  if (submenu) for (const item of submenu.items) item.checked = item.id === `agy-locale-${id}`;
  for (const wc of windows) if (!wc.isDestroyed() && hubOrigin(wc)) wc.reloadIgnoringCache();
}

fs.watchFile(configPath, { interval: 500, persistent: false }, () => {
  try { selectLocale(readConfig().locale); } catch (e) { log('config-error', { message: e.message }); }
});
app.once('quit', () => fs.unwatchFile(configPath));

const engine = import(pathToFileURL(path.join(root, 'lib/patch.mjs')).href);
engine.catch(e => log('engine-error', { message: e.message }));

function hubOrigin(wc) {
  try {
    const port = require(path.join(process.resourcesPath, 'app.asar/dist/languageServer.js')).getLsPort();
    const u = new URL(wc.getURL());
    return u.protocol === 'https:' && u.hostname === '127.0.0.1' && Number(u.port) === port ? u.origin : null;
  } catch { return null; }
}

async function translate(source) {
  const selected = locale;
  const dictionary = JSON.parse(fs.readFileSync(path.join(localesDir, `${selected}.json`), 'utf8'));
  const key = selected + ':' + crypto.createHash('sha256').update(source).update(JSON.stringify(dictionary)).digest('hex');
  if (!cache.has(key)) {
    const result = (await engine).patch(source, dictionary);
    if (cache.size >= 4) cache.delete(cache.keys().next().value);
    cache.set(key, result);
    log('patched', { locale: selected, replacements: result.changes.length, key });
  }
  return cache.get(key).code;
}

app.on('web-contents-created', (_event, wc) => {
  windows.add(wc);
  wc.once('destroyed', () => windows.delete(wc));
  const dbg = wc.debugger;
  // Install synchronously before the application calls loadURL.
  try { if (!dbg.isAttached()) dbg.attach('1.3'); } catch (e) { log('attach-error', { message: e.message }); return; }
  dbg.on('message', async (_event, method, params) => {
    if (method === 'Runtime.bindingCalled' && params.name === '__agyI18nLocale' && hubOrigin(wc) && locales.includes(params.payload)) {
      try {
        writeConfig({ locale: params.payload });
        selectLocale(params.payload);
      } catch (e) { log('config-error', { message: e.message }); }
      return;
    }
    if (method !== 'Fetch.requestPaused') return;
    const { requestId, request, resourceType, responseStatusCode } = params;
    const pass = () => dbg.sendCommand('Fetch.continueRequest', { requestId }).catch(() => {});
    let u;
    try { u = new URL(request.url); } catch { return pass(); }
    if (locale === 'en' || u.origin !== hubOrigin(wc) || u.pathname !== '/main.js' || resourceType !== 'Script' || responseStatusCode !== 200) return pass();
    try {
      const body = await dbg.sendCommand('Fetch.getResponseBody', { requestId });
      const source = body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body;
      const translated = await translate(source);
      const responseHeaders = (params.responseHeaders || []).filter(h => !['content-length', 'content-encoding', 'etag', 'content-md5', 'digest'].includes(h.name.toLowerCase()));
      await dbg.sendCommand('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders, body: Buffer.from(translated).toString('base64') });
      log('served', { locale, webContentsId: wc.id });
    } catch (e) { log('fallback', { message: e.message }); await pass(); }
  });
  dbg.sendCommand('Fetch.enable', { patterns: [{ urlPattern: 'https://127.0.0.1:*/main.js*', resourceType: 'Script', requestStage: 'Response' }] })
    .catch(e => log('enable-error', { message: e.message }));
  const binding = dbg.sendCommand('Runtime.enable').then(() => dbg.sendCommand('Runtime.addBinding', { name: '__agyI18nLocale' }));
  binding.catch(e => log('binding-error', { message: e.message }));
  wc.on('did-finish-load', async () => {
    if (!hubOrigin(wc)) return;
    try {
      await binding;
      await wc.executeJavaScript(`(() => {
        if (document.getElementById('agy-i18n-control')) return;
        const host = document.createElement('div'); host.id = 'agy-i18n-control';
        host.style.cssText = 'position:fixed;right:16px;bottom:8px;z-index:2147483647';
        const shadow = host.attachShadow({mode:'open'});
        const style = document.createElement('style');
        style.textContent = 'select{font:12px system-ui;padding:5px 8px;border:1px solid #8886;border-radius:8px;background:Canvas;color:CanvasText;color-scheme:light dark;box-shadow:0 1px 4px #0002;cursor:pointer}';
        const select = document.createElement('select'); select.setAttribute('aria-label','Display language / 显示语言');
        select.title = 'Display language / 显示语言（切换将刷新界面）';
        for (const [value,label] of ${JSON.stringify(languageEntries)}) {
          const option = document.createElement('option'); option.value=value;option.textContent=label;select.append(option);
        }
        select.value = ${JSON.stringify(locale)};
        select.onchange = () => globalThis.__agyI18nLocale(select.value);
        shadow.append(style,select);document.body.append(host);
      })()`);
    } catch (e) { log('control-error', { message: e.message }); }
  });
});

const originalSetMenu = Menu.setApplicationMenu.bind(Menu);
Menu.setApplicationMenu = function(menu) {
  if (menu && !menu.getMenuItemById('agy-i18n-language')) {
    const { MenuItem } = require('electron');
    menu.append(new MenuItem({
      id: 'agy-i18n-language',
      label: 'Language / 语言',
      submenu: languageEntries.map(([id, label]) => ({
        id: `agy-locale-${id}`,
        label,
        type: 'radio',
        checked: locale === id,
        click() {
          try {
            writeConfig({ locale: id });
            selectLocale(id);
          } catch (e) { log('config-error', { message: e.message }); }
        },
      })),
    }));
  }
  return originalSetMenu(menu);
};
log('loaded', { locale, availableLocales: locales.length });
