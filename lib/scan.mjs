// 在压缩后的 JS bundle 中找出“显示位置”上的字符串字面量。
// 只看位置（属性名 / JSX children），不看代码位置或变量名，因此不依赖固定偏移；更新后仍需重新解析和校验。
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

// 被视为“显示用”的属性名（对象字面量 key）
export const DISPLAY_PROPS = new Set([
  'children', 'title', 'placeholder', 'label', 'aria-label', 'ariaLabel',
  'description', 'tooltip', 'tooltipText', 'text', 'message', 'header', 'heading',
  'subtitle', 'caption', 'helperText', 'emptyText', 'buttonText',
  'confirmText', 'cancelText', 'alt',
]);

// jsx/createElement 一类调用的常见名字（压缩后可能被改名，所以只作为补充信号）
const JSX_CALLEES = new Set(['jsx', 'jsxs', 'jsxDEV', 'createElement', '_jsx', '_jsxs']);

const MAX_LEN = 200; // 过长的多半是提示词/文档，不碰

/** 判断一个字符串看起来是不是给人看的 UI 文案 */
export function looksLikeUiText(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (t.length < 2 || t.length > MAX_LEN) return false;
  if (!/[A-Za-z]/.test(t)) return false;
  // 纯标识符 / 路径 / URL / CSS 类名 / 常量
  if (/^[a-z0-9_\-.:/#@]+$/.test(t)) return false;          // kebab、snake、路径、url 片段
  if (/^[A-Z0-9_]+$/.test(t) && t.includes('_')) return false; // SOME_CONST
  if (/^[a-z]+[A-Z][A-Za-z0-9]*$/.test(t)) return false;     // camelCase
  if (/^(https?:|file:|data:|\.\/|\/)/.test(t)) return false;
  if (/[{}<>;=]|\$\{|=>/.test(t)) return false;               // 代码/模板
  // 要么以大写开头，要么含空格（句子）
  return /^[A-Z]/.test(t) || /\s/.test(t);
}

function propKeyName(prop) {
  if (!prop || prop.type !== 'Property' || prop.computed) return null;
  const k = prop.key;
  if (k.type === 'Identifier') return k.name;
  if (k.type === 'Literal' && typeof k.value === 'string') return k.value;
  return null;
}

function calleeName(node) {
  const c = node.callee;
  if (!c) return null;
  if (c.type === 'Identifier') return c.name;
  if (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier') return c.property.name;
  return null;
}

/** 解析代码；先按 module，失败再按 script */
export function parse(code) {
  const base = { ecmaVersion: 'latest', allowHashBang: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true };
  try { return acorn.parse(code, { ...base, sourceType: 'module' }); }
  catch { return acorn.parse(code, { ...base, sourceType: 'script' }); }
}

/**
 * 扫描一份 JS 源码，返回所有候选：{ start, end, value, quote, context }
 * start/end 是字面量（含引号）在源码中的位置，供 patch 阶段精确替换。
 */
export function scan(code) {
  const ast = parse(code);
  const hits = [];
  const seen = new Set();

  const pushLiteral = (node, context, eligible = false) => {
    if (!node || seen.has(node.start)) return;
    if (node.type === 'Literal' && typeof node.value === 'string' && looksLikeUiText(node.value)) {
      seen.add(node.start);
      hits.push({ start: node.start, end: node.end, value: node.value, quote: code[node.start], context, eligible });
    } else if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
      const v = node.quasis[0].value.cooked;
      if (looksLikeUiText(v)) {
        seen.add(node.start);
        hits.push({ start: node.start, end: node.end, value: v, quote: '`', context, eligible });
      }
    } else if (node.type === 'ArrayExpression' && context.endsWith('children')) {
      for (const el of node.elements) pushLiteral(el, context, eligible);
    } else if (node.type === 'ConditionalExpression') {
      // children: cond ? "Running" : "Stopped"
      pushLiteral(node.consequent, context, eligible);
      pushLiteral(node.alternate, context, eligible);
    } else if (node.type === 'LogicalExpression') {
      // children: cond && "Running" or value || "Not set"
      pushLiteral(node.right, context, eligible);
    }
  };

  const RESOLVER_PROPS = new Set([
    'resolveOptionToString', 'resolveOptionToDescription', 'displayResolver', 'getOptionTooltip',
  ]);

  walk.fullAncestor(ast, (node, _state, ancestors) => {
    if (node.type === 'Property') {
      const name = propKeyName(node);
      if (name && DISPLAY_PROPS.has(name)) {
        const object = ancestors.at(-2);
        const call = ancestors.at(-3);
        const uiCall = call?.type === 'CallExpression' && JSX_CALLEES.has(calleeName(call)) && call.arguments[1] === object;
        const keys = object?.type === 'ObjectExpression' ? object.properties.map(propKeyName) : [];
        // Display props of React calls, menu/command items, and UI setting/config definitions.
        // Ordinary data objects, enum keys, and generic message/description stay untouched.
        const eligible =
          (uiCall && ['children', 'title', 'placeholder', 'aria-label', 'ariaLabel', 'alt', 'text', 'tooltip', 'tooltipText', 'subtitle', 'emptyText', 'buttonText', 'confirmText', 'cancelText', 'header', 'heading', 'caption', 'helperText'].includes(name)) ||
          (uiCall && ['label', 'description'].includes(name) && (keys.some(k => ['description', 'settingKey', 'rightElement', 'title', 'subtitle', 'children', 'onClick', 'onSelect', 'onActivate', 'checked', 'value', 'onChange', 'icon', 'disabled'].includes(k)) || (call?.arguments.length > 2 && call.arguments[2]?.type !== 'Literal'))) ||
          (name === 'label' && !keys.includes('phase') && keys.some(k => ['id', 'icon', 'onClick', 'onSelect', 'onActivate', 'isProviderSetting', 'settingType', 'accelerator', 'testId', 'commandId', 'emptyMessageSingular', 'prefValues', 'description', 'action', 'badge', 'subtitle', 'groups'].includes(k))) ||
          (name === 'description' && !keys.includes('cli') && keys.some(k => ['isProviderSetting', 'settingType', 'prefValues', 'emptyMessageSingular', 'label', 'action', 'badge'].includes(k))) ||
          (name === 'subtitle' && keys.some(k => ['label', 'title', 'groups'].includes(k))) ||
          (name === 'title' && keys.some(k => ['diffInfoMap', 'subtitle'].includes(k))) ||
          (['placeholder', 'tooltip', 'aria-label', 'ariaLabel', 'emptyText', 'buttonText', 'confirmText', 'cancelText'].includes(name));
        pushLiteral(node.value, `prop:${name}`, eligible);
      }
    } else if (node.type === 'ReturnStatement' && node.argument) {
      if (ancestors.some(a => a.type === 'Property' && RESOLVER_PROPS.has(propKeyName(a)))) {
        pushLiteral(node.argument, 'resolver:return', true);
      }
    } else if (node.type === 'CallExpression') {
      // createElement(type, props, "child", "child2") 形式的 children
      const name = calleeName(node);
      if (name === 'createElement' && node.arguments.length > 2) {
        for (const a of node.arguments.slice(2)) pushLiteral(a, 'jsx:children', true);
      }
    }
  });

  return hits;
}
