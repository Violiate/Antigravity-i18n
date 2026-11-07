import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import * as asar from '@electron/asar';
import { ROOT_DIR } from '../lib/env.mjs';

const version = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'))).version;
const name = `agy-i18n-${version}-windows-x64`;
const zip = path.join(ROOT_DIR, 'dist', name + '.zip');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(hash(zip), fs.readFileSync(zip + '.sha256', 'utf8').split(' ')[0]);
fs.mkdirSync(path.join(ROOT_DIR, 'out/package-test'), { recursive: true });
const output = fs.mkdtempSync(path.join(ROOT_DIR, 'out', '离线包测试 & spaces-'));
execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath $env:AGY_ZIP -DestinationPath $env:AGY_OUTPUT'], { env: { ...process.env, AGY_ZIP: zip, AGY_OUTPUT: output } });
const extracted = path.join(output, name);
const manifest = JSON.parse(fs.readFileSync(path.join(extracted, 'MANIFEST.json')));
for (const file of manifest.files) {
  assert.equal(hash(path.join(extracted, file.path)), file.sha256, file.path);
  assert.ok(!/(^|\/)(out|probe|config\.json|install-state\.json)(\/|$)|\.(asar|png|log)$/.test(file.path), file.path);
}
const node = path.join(extracted, 'runtime/node.exe');
const runner = path.join(extracted, 'app/packaging/setup-runner.mjs');
// Remove developer Node/npm from PATH; retain only Windows OS utilities.
const env = { ...process.env, PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0` };
const input = path.join(output, 'fixture-source');
const resources = path.join(output, '模拟客户端/resources');
fs.mkdirSync(path.join(input, 'dist'), { recursive: true });fs.mkdirSync(resources, { recursive: true });
fs.writeFileSync(path.join(input, 'dist/main.js'), 'console.log("fixture");');
await asar.createPackage(input, path.join(resources, 'app.asar'));
const originalHash = hash(path.join(resources, 'app.asar'));
const results = [];
for (const action of ['discover', 'install', 'status', 'install', 'restore']) {
  const request = path.join(output, 'request.json');
  fs.writeFileSync(request, JSON.stringify({ action, directory: resources, locale: 'fr', proxy: '' }));
  const result = spawnSync(node, [runner, request], { env, cwd: output, encoding: 'utf8' });
  assert.equal(result.status, 0, `${action}: ${result.stderr}`);
  if (action === 'status') assert.equal(JSON.parse(result.stdout).installed, true);
  results.push({ action, pass: true });
}
assert.equal(hash(path.join(resources, 'app.asar')), originalHash);
const gui = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', path.join(extracted, 'app/packaging/Setup.ps1'), '-SmokeTest'], { env, encoding: 'utf8' });
assert.equal(gui.status, 0, gui.stderr);
const report = { zipSha256: hash(zip), verifiedFiles: manifest.files.length, noDeveloperNodeOnPath: true, results, gui: gui.stdout.trim(), restoredBytesMatch: true };
fs.mkdirSync(path.join(ROOT_DIR, 'out/package-test'), { recursive: true });
fs.writeFileSync(path.join(ROOT_DIR, 'out/package-test/report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
