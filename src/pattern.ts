import type { Pattern } from './types';

const TOKEN_RE = /[a-z]|[0-9]|\./g;

/**
 * 解析单条模式。合法形式：
 *   [0-9]? "."? ( [a-z] [0-9]? )+ "."?   —— 即小写字母为主体，
 *   两端可带边界符 "."，每个字符间隙（含首尾）至多一位 0～9 数字。
 * 返回 Pattern；非法时返回错误描述字符串。
 */
export function parsePattern(raw: string, index: number): Pattern | string {
  const tokens = raw.match(TOKEN_RE);
  if (!tokens || tokens.join('') !== raw) {
    return `模式 #${index + 1} "${raw}" 含非法字符（仅允许 a-z、0-9 与边界符 .）`;
  }
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== '.') continue;
    const atStart = i === 0 || (i === 1 && /[0-9]/.test(tokens[0]));
    const atEnd =
      i === tokens.length - 1 ||
      (i === tokens.length - 2 && /[0-9]/.test(tokens[tokens.length - 1]));
    if (!atStart && !atEnd) {
      return `模式 #${index + 1} "${raw}" 的边界符 . 只能出现在两端`;
    }
  }
  if (!tokens.some((t) => /[a-z]/.test(t))) {
    return `模式 #${index + 1} "${raw}" 不含字母`;
  }

  const key = tokens.filter((t) => !/[0-9]/.test(t)).join('');
  const slots: (number | null)[] = new Array(key.length + 1).fill(null);
  let gap = 0;
  for (const t of tokens) {
    if (/[0-9]/.test(t)) {
      if (slots[gap] !== null) {
        return `模式 #${index + 1} "${raw}" 在同一间隙含多个数字`;
      }
      slots[gap] = Number(t);
    } else {
      gap += 1; // 字母与边界点都是 key 中的一个字符
    }
  }

  return {
    raw,
    key,
    letters: key.replace(/\./g, ''),
    hasLeadingDot: key.startsWith('.'),
    hasTrailingDot: key.endsWith('.'),
    slots,
    index,
  };
}
