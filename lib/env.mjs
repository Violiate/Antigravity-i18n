import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');
export const LOCALES_DIR = path.join(ROOT_DIR, 'locales');
export const RUNTIME_LOADER = path.join(ROOT_DIR, 'runtime', 'loader.cjs');

/**
 * Normalize a user-supplied path (app root, .app bundle, or resources dir)
 * to the directory containing `app.asar`.
 */
export function normalizeResourcesDir(inputPath) {
  if (!inputPath) return null;
  const resolved = path.resolve(inputPath);
  const candidates = [
    resolved,
    path.join(resolved, 'resources'),
    path.join(resolved, 'Resources'),
    path.join(resolved, 'Contents', 'Resources'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'app.asar')) || fs.existsSync(path.join(dir, 'app.asar.unpacked'))) {
      return dir;
    }
  }
  return resolved;
}

/**
 * Parse CLI arguments for `--dir <path>` or `--resources <path>`.
 */
export function parseCliArgs(argv = process.argv.slice(2)) {
  const positional = [];
  let customDir = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--dir' || arg === '--resources' || arg === '-d') && (!argv[i + 1] || argv[i + 1].startsWith('--'))) throw new Error(`${arg} 缺少目录参数`);
    if ((arg === '--dir' || arg === '--resources' || arg === '-d') && argv[i + 1]) {
      customDir = argv[++i];
    } else if (arg.startsWith('--dir=')) {
      customDir = arg.slice('--dir='.length);
    } else if (arg.startsWith('--resources=')) {
      customDir = arg.slice('--resources='.length);
    } else {
      positional.push(arg);
    }
  }
  return { positional, customDir };
}

/**
 * Discover Antigravity's `resources` directory across Windows, macOS, and Linux.
 */
export function resolveResourcesDir(customDir = null) {
  const explicit = customDir || process.env.AGY_RESOURCES_DIR || process.env.AGY_PATH;
  if (explicit) {
    return normalizeResourcesDir(explicit);
  }

  const home = os.homedir();
  const candidates = [];

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    candidates.push(
      path.join(localAppData, 'Programs', 'antigravity', 'resources'),
      path.join(localAppData, 'Programs', 'Antigravity', 'resources'),
      path.join(programFiles, 'Antigravity', 'resources'),
      path.join(programFilesX86, 'Antigravity', 'resources'),
      path.join(home, 'scoop', 'apps', 'antigravity', 'current', 'resources'),
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Antigravity.app/Contents/Resources',
      path.join(home, 'Applications', 'Antigravity.app', 'Contents', 'Resources'),
    );
  } else {
    candidates.push(
      '/opt/Antigravity/resources',
      '/opt/antigravity/resources',
      '/usr/lib/antigravity/resources',
      '/usr/share/antigravity/resources',
      path.join(home, '.local', 'share', 'antigravity', 'resources'),
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'app.asar'))) {
      return candidate;
    }
  }

  return candidates[0];
}

/**
 * Resolve the Antigravity executable path from its `resources` directory.
 */
export function resolveExecutablePath(resourcesDir = resolveResourcesDir()) {
  if (process.platform === 'win32') {
    return path.resolve(resourcesDir, '..', 'Antigravity.exe');
  }
  if (process.platform === 'darwin') {
    return path.resolve(resourcesDir, '..', 'MacOS', 'Antigravity');
  }
  const linuxCandidate = path.resolve(resourcesDir, '..', 'antigravity');
  if (fs.existsSync(linuxCandidate)) return linuxCandidate;
  return path.resolve(resourcesDir, '..', 'Antigravity');
}

/**
 * Check if any Antigravity process is currently running (cross-platform).
 * When `resourcesDir` is provided and no Antigravity executable exists alongside it
 * (e.g., an isolated test fixture directory), returns false.
 */
export function isAntigravityRunning(resourcesDir = null) {
  if (resourcesDir && !fs.existsSync(resolveExecutablePath(resourcesDir))) {
    return false;
  }
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Antigravity.exe', '/NH'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return /Antigravity\.exe/i.test(out);
    }
    const out = execFileSync('pgrep', ['-f', 'Antigravity'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return Boolean(out.trim());
  } catch {
    return false;
  }
}

/**
 * Load supported languages from `locales/languages.json` and auto-discover any additional `locales/*.json`.
 */
export function getSupportedLanguages() {
  const manifestPath = path.join(LOCALES_DIR, 'languages.json');
  const languages = [];
  const seen = new Set();

  if (fs.existsSync(manifestPath)) {
    try {
      const list = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      for (const item of list) {
        if (item?.code && (item.code === 'en' || fs.existsSync(path.join(LOCALES_DIR, `${item.code}.json`)))) {
          languages.push(item);
          seen.add(item.code);
        }
      }
    } catch {
      // Fallback to directory scan below
    }
  }

  if (!seen.has('en')) {
    languages.unshift({ code: 'en', name: 'English', nativeName: 'English', label: 'English (Original)' });
    seen.add('en');
  }

  if (fs.existsSync(LOCALES_DIR)) {
    for (const file of fs.readdirSync(LOCALES_DIR)) {
      if (!file.endsWith('.json') || file === 'languages.json') continue;
      const code = file.slice(0, -5);
      if (!seen.has(code)) {
        languages.push({ code, name: code, nativeName: code, label: code });
        seen.add(code);
      }
    }
  }

  return languages;
}

export function getSupportedLocaleCodes() {
  return getSupportedLanguages().map(l => l.code);
}
