import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT_DIR, resolveResourcesDir, getSupportedLanguages } from '../lib/env.mjs';

try {
  const request = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
  if (request.action === 'discover') {
    console.log(JSON.stringify({ resources: resolveResourcesDir(), languages: getSupportedLanguages() }));
  } else {
    if (!['install', 'restore', 'status'].includes(request.action)) throw new Error('无效操作');
    let proxy;
    if (request.action === 'install' && request.proxy?.trim()) {
      proxy = new URL(request.proxy.trim());
      if (!['http:', 'https:'].includes(proxy.protocol) || proxy.username || proxy.password) throw new Error('代理须为不带账号密码的 http:// 或 https:// 地址');
    }
    const args = [path.join(ROOT_DIR, 'install.mjs'), request.action];
    if (request.action === 'install') args.push(request.locale || 'zh-CN');
    if (request.directory?.trim()) args.push('--dir', request.directory.trim());
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || `安装进程异常退出 (${result.status ?? result.signal})`);
    if (request.action === 'install' && request.proxy !== undefined) {
      const config = path.join(resolveResourcesDir(request.directory), 'agy-i18n/config.json');
      const data = JSON.parse(fs.readFileSync(config, 'utf8'));
      if (proxy) data.proxy = proxy.href; else delete data.proxy;
      fs.writeFileSync(config, JSON.stringify(data, null, 2));
    }
    console.log(result.stdout.trim());
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
