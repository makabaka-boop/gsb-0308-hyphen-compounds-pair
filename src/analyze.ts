import type { DictionaryConfig, ExceptionWord, GapInfo, Pattern, WordResult } from './types';
import { PatternTrie } from './trie';

/** 例外词显式断点的生效分值（奇数，使奇偶规则天然判为可断） */
export const EXCEPTION_SCORE = 9;

/**
 * 断字分析器：由模式 trie、例外词表与左右最少保留字母数构成。
 * 判定顺序（每个间隙）：
 *   1. 词边界间隙（0 / n）永不参与断字；
 *   2. 例外词：显式断点覆盖模式结果（仍受左右限制约束），
 *      未标记的间隙一律禁止断开；
 *   3. 普通词：模式最大分值为奇数且左右保留字母数达标才可断。
 */
export class Hyphenator {
  private readonly patterns: Pattern[];
  private readonly trie: PatternTrie;
  private readonly exceptions: Map<string, ExceptionWord>;
  private readonly config: DictionaryConfig;

  constructor(patterns: Pattern[], exceptions: ExceptionWord[], config: DictionaryConfig) {
    this.patterns = patterns;
    this.trie = new PatternTrie(patterns);
    this.exceptions = new Map(exceptions.map((e) => [e.word, e]));
    this.config = config;
  }

  analyze(word: string): WordResult {
    const n = word.length;
    const dotted = `.${word}.`;
    const scores = this.trie.score(dotted, n);
    const exc = this.exceptions.get(word) ?? null;

    const gaps: GapInfo[] = [];
    for (let g = 0; g <= n; g++) {
      const patternScore = scores[g].score;
      const srcIdx = scores[g].patternIndex;
      const patternSource = srcIdx >= 0 ? this.patterns[srcIdx] : null;
      const exceptionMark = exc !== null && exc.breaks.has(g);

      let finalScore = patternScore;
      let finalSource = patternSource ? `模式 "${patternSource.raw}"` : '无模式命中';
      let status: GapInfo['status'];
      let reason: string;

      if (g === 0 || g === n) {
        status = 'edge';
        reason = '词边界间隙，不参与断字';
      } else if (exc !== null) {
        if (exceptionMark) {
          finalScore = EXCEPTION_SCORE;
          finalSource = `例外 "${exc.raw}"`;
          if (g < this.config.leftMin) {
            status = 'exception-left-min';
            reason = `例外显式断点，但左侧仅 ${g} 个字母，少于 lefthyphenmin=${this.config.leftMin}`;
          } else if (n - g < this.config.rightMin) {
            status = 'exception-right-min';
            reason = `例外显式断点，但右侧仅 ${n - g} 个字母，少于 righthyphenmin=${this.config.rightMin}`;
          } else {
            status = 'exception-break';
            reason = '例外词显式断点，覆盖模式结果';
          }
        } else {
          finalScore = 0;
          finalSource = `例外 "${exc.raw}"（未标记）`;
          status = 'exception-blocked';
          reason = '例外词未在此标记断点，禁止断开（覆盖模式结果）';
        }
      } else if (patternScore % 2 === 0) {
        status = 'even';
        reason = patternSource
          ? `最大分值 ${patternScore} 为偶数，不可断`
          : '无模式命中，分值 0（偶数），不可断';
      } else if (g < this.config.leftMin) {
        status = 'left-min';
        reason = `分值 ${patternScore} 为奇数，但左侧仅 ${g} 个字母，少于 lefthyphenmin=${this.config.leftMin}`;
      } else if (n - g < this.config.rightMin) {
        status = 'right-min';
        reason = `分值 ${patternScore} 为奇数，但右侧仅 ${n - g} 个字母，少于 righthyphenmin=${this.config.rightMin}`;
      } else {
        status = 'break';
        reason = `分值 ${patternScore} 为奇数且通过左右限制，可断`;
      }

      gaps.push({
        gap: g,
        left: g,
        right: n - g,
        patternScore,
        patternSource,
        exceptionMark,
        finalScore,
        finalSource,
        status,
        breakable: status === 'break' || status === 'exception-break',
        reason,
      });
    }

    const breakPoints = gaps.filter((x) => x.breakable).map((x) => x.gap);
    const breakSet = new Set(breakPoints);
    let hyphenated = '';
    for (let i = 0; i < n; i++) {
      hyphenated += word[i];
      if (breakSet.has(i + 1)) hyphenated += '-';
    }

    return { word, dotted, gaps, breakPoints, hyphenated, isException: exc !== null };
  }
}
