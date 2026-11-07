import MagicString from 'magic-string';
import { parse, scan } from './scan.mjs';

// Offsets always come from the current source, never from a previous release.
export function patch(code, dictionary) {
  if (!dictionary || typeof dictionary !== 'object' || Array.isArray(dictionary)) throw new Error('词库必须是 JSON 对象');
  const output = new MagicString(code);
  const changes = [];
  for (const hit of scan(code)) {
    if (!hit.eligible || !Object.hasOwn(dictionary, hit.value)) continue;
    const translation = dictionary[hit.value];
    if (typeof translation !== 'string' || !translation.length) throw new Error(`无效译文: ${hit.value}`);
    if (translation === hit.value) continue;
    output.overwrite(hit.start, hit.end, JSON.stringify(translation).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'));
    changes.push({ ...hit, translation });
  }
  const result = output.toString();
  parse(result);
  return { code: result, changes };
}
