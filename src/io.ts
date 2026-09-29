import type { DictionaryConfig, ExceptionWord, Pattern, WordResult } from './types';
import { parsePattern } from './pattern';

export const MAX_PATTERNS = 1000;
export const MAX_WORDS = 2000;
export const MAX_WORD_LEN = 40;
export const MAX_EXCEPTIONS = 2000;

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

/** 解析模式区：每行一条，合法 1～1000 条；非法行记入 errors 并跳过 */
export function parsePatterns(text: string): { patterns: Pattern[]; errors: string[] } {
  const patterns: Pattern[] = [];
  const errors: string[] = [];
  const seen = new Map<string, number>();

  for (const line of lines(text)) {
    if (patterns.length >= MAX_PATTERNS) {
      errors.push(`模式数量超过 ${MAX_PATTERNS} 条，其余已忽略`);
      break;
    }
    const r = parsePattern(line, patterns.length);
    if (typeof r === 'string') {
      errors.push(r);
      continue;
    }
    const sig = `${r.key}|${r.slots.map((s) => s ?? '').join(',')}`;
    const dup = seen.get(sig);
    if (dup !== undefined) {
      errors.push(`模式 "${line}" 与 #${dup + 1} 重复，已忽略`);
      continue;
    }
    seen.set(sig, r.index);
    patterns.push(r);
  }
  if (patterns.length === 0) errors.push('至少需要 1 条合法模式');
  return { patterns, errors };
}

/**
 * 例外条目对应的输入词：
 * "=" 表示复合词固定连接号，先归一为输入词中的 "-"，
 * 再去掉所有显式断点标记 "-"（纯字母部分用于字母数上限校验）。
 */
function exceptionWord(line: string): string {
  // '=' 归一为输入词中的固定连接号 '-'；作为断点标记的 '-' 直接删除。
  // 顺序不能反：先归一再删除才能同时区分两种连字符。
  let word = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '=') word += '-';
    else if (ch !== '-') word += ch;
  }
  return word;
}
function exceptionLetters(line: string): string {
  return exceptionWord(line).replace(/-/g, '');
}

/** 解析例外词表："-" 标记断点，"=" 标记复合词固定边界；同词重复时后者覆盖前者 */
export function parseExceptions(text: string): { exceptions: ExceptionWord[]; errors: string[] } {
  const byWord = new Map<string, ExceptionWord>();
  const errors: string[] = [];

  for (const line of lines(text)) {
    const word = exceptionWord(line);
    if (byWord.size >= MAX_EXCEPTIONS && !byWord.has(word)) {
      errors.push(`例外词数量超过 ${MAX_EXCEPTIONS} 条，其余已忽略`);
      break;
    }
    if (!/^[a-z=-]+$/.test(line)) {
      errors.push(`例外词 "${line}" 含非法字符（仅允许 a-z、- 与 =），已忽略`);
      continue;
    }
    if (exceptionLetters(line).length === 0) {
      errors.push(`例外词 "${line}" 不含字母，已忽略`);
      continue;
    }
    if (exceptionLetters(line).length > MAX_WORD_LEN) {
      errors.push(`例外词 "${line}" 超过 ${MAX_WORD_LEN} 个字母，已忽略`);
      continue;
    }
    // 连续连接号不合法；词首/词尾的连接号（- 或 =）无效，仅告警后忽略
    if (/[-=]{2,}/.test(line)) {
      errors.push(`例外词 "${line}" 含连续连接号，已忽略`);
      continue;
    }
    // 断点位置相对归一后的 word：'=' 与字母在 word 中占位置，
    // 断点标记 '-' 不占位置
    const breaks = new Set<number>();
    let edgeDropped = 0;
    let pos = 0;
    for (const ch of line) {
      if (ch === '-') {
        if (pos >= 1 && pos <= word.length - 1) breaks.add(pos);
        else edgeDropped += 1;
      } else {
        pos += 1; // '=' 归一为 word 中的连接号，同样占位置
      }
    }
    if (edgeDropped > 0) {
      errors.push(`例外词 "${line}" 词首/词尾的连接号无效，已忽略该标记`);
    }
    byWord.set(word, { raw: line, word, breaks, index: byWord.size });
  }
  return { exceptions: [...byWord.values()], errors };
}

/** 解析待断字词表：空白分隔，支持带连接号的复合词；重复词静默去重 */
export function parseWords(text: string): { words: string[]; errors: string[] } {
  const words: string[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];

  for (const token of text.split(/\s+/).filter(Boolean)) {
    if (words.length >= MAX_WORDS) {
      errors.push(`词条数量超过 ${MAX_WORDS} 个，其余已忽略`);
      break;
    }
    if (!/^[a-z]+(?:-[a-z]+)*$/.test(token)) {
      errors.push(`词条 "${token}" 含非法字符（仅允许小写字母及词段间连接号），已忽略`);
      continue;
    }
    if (token.replace(/-/g, '').length > MAX_WORD_LEN) {
      errors.push(`词条 "${token}" 超过 ${MAX_WORD_LEN} 个字母，已忽略`);
      continue;
    }
    if (seen.has(token)) continue;
    seen.add(token);
    words.push(token);
  }
  return { words, errors };
}

/** 限制参数取值范围 0～40 */
export function sanitizeConfig(leftMin: number, rightMin: number): DictionaryConfig {
  const clamp = (v: number) => (Number.isFinite(v) ? Math.min(40, Math.max(0, Math.trunc(v))) : 0);
  return { leftMin: clamp(leftMin), rightMin: clamp(rightMin) };
}

/**
 * 导出 JSON：与页面高亮使用同一份 WordResult，
 * 保证 breakPoints / hyphenated / 逐间隙 breakable 三者一致。
 */
export function exportJSON(
  results: WordResult[],
  config: DictionaryConfig,
  patterns: Pattern[],
  exceptions: ExceptionWord[],
): string {
  const data = {
    version: 1,
    config,
    patterns: patterns.map((p) => p.raw),
    exceptions: exceptions.map((e) => e.raw),
    words: results.map((r) => ({
      word: r.word,
      hyphenated: r.hyphenated,
      breakPoints: r.breakPoints,
      fixedBoundaries: r.fixedBoundaries,
      exception: r.isException,
      gaps: r.gaps.map((g) => ({
        gap: g.gap,
        left: g.left,
        right: g.right,
        fixedBoundary: g.fixedBoundary,
        finalScore: g.finalScore,
        patternScore: g.patternScore,
        source: g.finalSource,
        pattern: g.patternSource ? g.patternSource.raw : null,
        status: g.status,
        breakable: g.breakable,
        reason: g.reason,
      })),
    })),
  };
  return JSON.stringify(data, null, 2);
}
