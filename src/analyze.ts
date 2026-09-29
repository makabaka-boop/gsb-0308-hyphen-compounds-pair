import type { DictionaryConfig, ExceptionWord, GapInfo, Pattern, WordResult } from './types';
import { PatternTrie } from './trie';

/** 例外词显式断点的生效分值（奇数，使奇偶规则天然判为可断） */
export const EXCEPTION_SCORE = 9;

/** 一个词段（复合词以连接号切分）在原输入串中的上下文 */
interface SegmentCtx {
  /** 词段文本 */
  text: string;
  /** 词段起点在原输入串中的下标 */
  start: number;
  /** 词段长度（字母数） */
  len: number;
  /** 词段自身的模式计分：本地间隙 0..len */
  scores: { score: number; patternIndex: number }[];
  /** 词段在复合词中的序号（0 起） */
  segIndex: number;
  /**
   * 适用于本词段的例外：整条复合词有例外时取整条例外，
   * 否则取与词段文本完全相同的词段级例外；都没有则为 null。
   */
  exc: ExceptionWord | null;
  /** 本词段的例外是否来自整条复合词（来源说明措辞不同） */
  wholeException: boolean;
}

/**
 * 断字分析器：由模式 trie、例外词表与左右最少保留字母数构成。
 * 判定顺序（每个间隙）：
 *   1. 词边界间隙（0 / n）永不参与断字；
 *   2. 复合词连接号两侧为固定边界间隙，永不参与断字；
 *   3. 例外词：显式断点覆盖模式结果（仍受左右限制约束），
 *      未标记的间隙一律禁止断开；
 *   4. 普通词：模式最大分值为奇数且左右保留字母数达标才可断。
 *
 * 复合词（含连接号 "-"）按各词段独立计分：模式、左右保留字母数与
 * 例外均相对词段判定；整条复合词有例外条目时它覆盖各词段自身的
 * 例外与模式。所有间隙编号沿原输入串统一计数。
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

  /** 建立各词段上下文：切分、独立计分、确定适用的例外 */
  private buildSegments(word: string, wholeExc: ExceptionWord | null): SegmentCtx[] {
    const segments: SegmentCtx[] = [];
    let start = 0;
    let segIndex = 0;
    for (let i = 0; i <= word.length; i++) {
      if (i < word.length && word[i] !== '-') continue;
      const text = word.slice(start, i);
      const len = text.length;
      const scores = this.trie.score(`.${text}.`, len);
      segments.push({
        text,
        start,
        len,
        segIndex,
        scores,
        exc: wholeExc ?? this.exceptions.get(text) ?? null,
        wholeException: wholeExc !== null,
      });
      start = i + 1;
      segIndex += 1;
    }
    return segments;
  }

  analyze(word: string): WordResult {
    const n = word.length;
    const isCompound = word.includes('-');
    const wholeExc = this.exceptions.get(word) ?? null;
    const segments = this.buildSegments(word, wholeExc);

    /** 由全局间隙号定位所属词段（间隙 g 在第 g 个字符之后） */
    const segmentAt = (g: number): SegmentCtx => {
      let idx = 0;
      for (let s = 0; s < segments.length; s++) {
        const seg = segments[s];
        // 词段字符占据 [start, start+len)；其后是连接号或串尾
        if (g <= seg.start + seg.len) {
          idx = s;
          break;
        }
      }
      return segments[idx];
    };

    const isGlobalEdge = (g: number) => g === 0 || g === n;
    /** 连接号前一个（词段尾）或后一个（下一词段首）间隙 */
    const isFixedBoundary = (g: number) => word[g - 1] === '-' || word[g] === '-';

    const gaps: GapInfo[] = [];
    for (let g = 0; g <= n; g++) {
      const seg = segmentAt(g);
      const local = g - seg.start; // 词段内本地间隙号 0..len
      const patternScore = seg.scores[local].score;
      const srcIdx = seg.scores[local].patternIndex;
      const patternSource = srcIdx >= 0 ? this.patterns[srcIdx] : null;
      const exc = seg.exc;
      // 词段级例外的断点相对词段本地编号；整条复合例外的断点已是全局编号
      const exceptionMark =
        exc !== null && (seg.wholeException ? exc.breaks.has(g) : exc.breaks.has(local));

      let finalScore = patternScore;
      let finalSource = patternSource ? `模式 "${patternSource.raw}"` : '无模式命中';
      let status: GapInfo['status'];
      let reason: string;

      const segLabel = isCompound
        ? `（词段 "${seg.text}"，第 ${seg.segIndex + 1}/${segments.length} 段）`
        : '';
      const excLabel = seg.wholeException
        ? `复合词例外 "${exc!.raw}"`
        : isCompound
          ? `词段例外 "${exc?.raw ?? ''}"（作用于词段 "${seg.text}"）`
          : `例外 "${exc?.raw ?? ''}"`;

      if (isGlobalEdge(g)) {
        status = 'edge';
        reason = '词边界间隙，不参与断字';
      } else if (isFixedBoundary(g)) {
        status = 'fixed-boundary';
        finalSource = '复合词连接号（固定边界，不可断）';
        reason = `复合词词段边缘的固定边界间隙${segLabel}，连接号是原词的一部分，此处不参与断字`;
      } else if (exc !== null) {
        if (exceptionMark) {
          finalScore = EXCEPTION_SCORE;
          finalSource = `${excLabel} 的显式断点`;
          if (local < this.config.leftMin) {
            status = 'exception-left-min';
            reason = `例外显式断点，但${segLabel ? `词段左侧仅 ${local} 个字母` : `左侧仅 ${local} 个字母`}，少于 lefthyphenmin=${this.config.leftMin}`;
          } else if (seg.len - local < this.config.rightMin) {
            status = 'exception-right-min';
            reason = `例外显式断点，但${segLabel ? `词段右侧仅 ${seg.len - local} 个字母` : `右侧仅 ${seg.len - local} 个字母`}，少于 righthyphenmin=${this.config.rightMin}`;
          } else {
            status = 'exception-break';
            reason = `例外词显式断点，覆盖模式结果${segLabel}`;
          }
        } else {
          finalScore = 0;
          finalSource = `${excLabel}（未标记）`;
          status = 'exception-blocked';
          reason = `例外词未在此标记断点，禁止断开（覆盖模式结果）${segLabel}`;
        }
      } else if (patternScore % 2 === 0) {
        status = 'even';
        reason = patternSource
          ? `最大分值 ${patternScore} 为偶数，不可断${segLabel}`
          : `无模式命中，分值 0（偶数），不可断${segLabel}`;
      } else if (local < this.config.leftMin) {
        status = 'left-min';
        reason = `分值 ${patternScore} 为奇数，但${segLabel ? `词段左侧仅 ${local} 个字母` : `左侧仅 ${local} 个字母`}，少于 lefthyphenmin=${this.config.leftMin}`;
      } else if (seg.len - local < this.config.rightMin) {
        status = 'right-min';
        reason = `分值 ${patternScore} 为奇数，但${segLabel ? `词段右侧仅 ${seg.len - local} 个字母` : `右侧仅 ${seg.len - local} 个字母`}，少于 righthyphenmin=${this.config.rightMin}`;
      } else {
        status = 'break';
        reason = `分值 ${patternScore} 为奇数且通过左右限制，可断${segLabel}`;
      }

      gaps.push({
        gap: g,
        left: local,
        right: seg.len - local,
        patternScore,
        patternSource,
        exceptionMark,
        fixedBoundary: status === 'fixed-boundary',
        finalScore,
        finalSource,
        status,
        breakable: status === 'break' || status === 'exception-break',
        reason,
      });
    }

    const breakPoints = gaps.filter((x) => x.breakable).map((x) => x.gap);
    const fixedBoundaries = gaps.filter((x) => x.fixedBoundary).map((x) => x.gap);
    const breakSet = new Set(breakPoints);
    let hyphenated = '';
    for (let i = 0; i < n; i++) {
      hyphenated += word[i];
      if (breakSet.has(i + 1)) hyphenated += '-';
    }

    const isException =
      wholeExc !== null || segments.some((s) => !s.wholeException && s.exc !== null);
    return {
      word,
      dotted: `.${word}.`,
      gaps,
      breakPoints,
      hyphenated,
      isException,
      fixedBoundaries,
    };
  }
}
