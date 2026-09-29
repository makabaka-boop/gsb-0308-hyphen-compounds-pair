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

/** 解析例外词表："-" 标记断点，"=" 标记复合词固定边界；同词重复时后者覆盖前者 */
export function parseExceptions(text: string): { exceptions: ExceptionWord[]; errors: string[] } {
  const byWord = new Map<string, ExceptionWord>();
  const errors: string[] = [];

  for (const line of lines(text)) {
    if (byWord.size >= MAX_EXCEPTIONS && !byWord.has(line.replace(/-/g, '').replace(/=/g, '-'))) {
      errors.push(`例外词数量超过 ${MAX_EXCEPTIONS} 条，其余已忽略`);
      break;
    }
    if (!/^[a-z=-]+$/.test(line)) {
      errors.push(`例外词 "${line}" 含非法字符（仅允许 a-z、- 与 =），已忽略`);
      continue;
    }
    const word = line.replace(/-/g, '').replace(/=/g, '-');
    if (word.length === 0) {
      errors.push(`例外词 "${line}" 不含字母，已忽略`);
      continue;
    }
    if (word.replace(/-/g, '').length > MAX_WORD_LEN) {
      errors.push(`例外词 "${line}" 超过 ${MAX_WORD_LEN} 个字母，已忽略`);
      continue;
    }
    const breaks = new Set<number>();
    let pos = 0;
    let dropped = 0;
    for (const ch of line) {
      if (ch === '-') {
        if (pos >= 1 && pos <= word.length - 1) breaks.add(pos);
        else dropped += 1;
      } else {
        pos += 1;
      }
    }
    if (dropped > 0) errors.push(`例外词 "${line}" 词首/词尾的连字符无效，已忽略该标记`);
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
      exception: r.isException,
      gaps: r.gaps.map((g) => ({
        gap: g.gap,
        left: g.left,
        right: g.right,
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
