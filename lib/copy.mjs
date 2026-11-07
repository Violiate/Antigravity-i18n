import fs from 'node:fs';
import path from 'node:path';

// Avoid fs.cpSync: some Windows runtime builds terminate in its recursive path.
// Source payload is entirely regular files/directories, never symbolic links.
export function copyTree(source, target) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`不支持的符号链接: ${source}`);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const name of fs.readdirSync(source)) copyTree(path.join(source, name), path.join(target, name));
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}
