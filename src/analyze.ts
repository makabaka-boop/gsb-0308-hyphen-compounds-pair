import type {
  DictionaryConfig,
  ExceptionWord,
  GapInfo,
  Pattern,
  SegmentInfo,
  WordResult,
} from './types';
import { PatternTrie } from './trie';

/** 例外词显式断点的生效分值（奇数，使奇偶规则天然判为可断） */
export const EXCEPTION_SCORE = 9;

/**
 * 断字分析器：由模式 trie、例外词表与左右最少保留字母数构成。
 *
 * 复合词（如 "ab-cd"）按连接号切分为词段后**逐段独立判定**：
 * 每段各自加边界符（".ab." / ".cd."），因此带边界符的模式贴在词段边缘即可命中；
 * 模式、左右保留字母数与例外均按词段局部计算；连接号两侧的词段边缘间隙为
 * 固定边界，永不参与断字。整条复合词若有例外条目，则它覆盖各段自身的例外与模式。
 *
 * 间隙编号沿含连接号的原输入串统一编号：间隙 g 位于原串下标 g 与 g+1 之间。
 *
 * 每个内部间隙的判定顺序：
 *   1. 例外词：显式断点覆盖模式结果（仍受段内左右限制约束），
 *      未标记的间隙一律禁止断开；
 *   2. 普通词：模式最大分值为奇数且段内左右保留字母数达标才可断。
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
    const parts = word.split('-');
    const compound = parts.length > 1;
    // 整条复合词的例外条目（普通单词也走这一支）；存在时覆盖各段自身例外
    const wholeExc = this.exceptions.get(word) ?? null;

    // 先确定每段的偏移、长度与生效例外
    const segInfos: SegmentInfo[] = [];
    let offset = 0;
    for (let s = 0; s < parts.length; s++) {
      const text = parts[s];
      const segExc = wholeExc ?? (compound ? this.exceptions.get(text) ?? null : null);
      segInfos.push({
        index: s,
        text,
        start: offset,
        length: text.length,
        exception: segExc,
        exceptionScope: wholeExc ? 'whole' : segExc ? 'segment' : null,
      });
      offset += text.length + 1; // 词段后紧跟一个连接号字符
    }

    const n = word.length;
    const gaps: GapInfo[] = [];

    for (let s = 0; s < segInfos.length; s++) {
      const seg = segInfos[s];
      const m = seg.length;
      const base = seg.start;
      const exc = seg.exception;
      // 每段独立加边界符扫描：带点模式只贴该段自己的首尾
      const scores = this.trie.score(`.${seg.text}.`, m);

      for (let j = 0; j <= m; j++) {
        const g = base + j; // 原输入串上的全局间隙号
        const { score: patternScore, patternIndex } = scores[j];
        const patternSource = patternIndex >= 0 ? this.patterns[patternIndex] : null;
        // 整条词例外的断点按全局位置标记；词段自身例外按段内位置标记
        const exceptionMark =
          exc !== null && (exc === wholeExc ? exc.breaks.has(g) : exc.breaks.has(j));

        const atSegStart = j === 0;
        const atSegEnd = j === m;
        // 非首段的左缘、非末段的右缘紧邻连接号，为固定边界
        const fixed = (atSegStart && s > 0) || (atSegEnd && s < segInfos.length - 1);
        // 整条词首尾的边界间隙
        const edge = (atSegStart && s === 0) || (atSegEnd && s === segInfos.length - 1);

        let finalScore = patternScore;
        let finalSource = patternSource ? `模式 "${patternSource.raw}"` : '无模式命中';
        let exceptionSource: string | null = exc !== null ? exc.raw : null;
        let status: GapInfo['status'];
        let reason: string;

        if (edge) {
          status = 'edge';
          reason = '词边界间隙，不参与断字';
          exceptionSource = null;
        } else if (fixed) {
          // 固定边界优先：即便例外在此误标断点也不可断
          finalScore = 0;
          finalSource = '复合词连接号（固定边界）';
          status = 'fixed-boundary';
          reason = exceptionMark
            ? `紧邻连接号的词段边缘间隙，固定不可断（例外 "${exc!.raw}" 在此的标记不生效）`
            : '紧邻连接号的词段边缘间隙，固定不可断';
        } else if (exc !== null) {
          if (exceptionMark) {
            finalScore = EXCEPTION_SCORE;
            finalSource =
              seg.exceptionScope === 'whole'
                ? `例外 "${exc.raw}"（整条复合词）`
                : `词段例外 "${exc.raw}"`;
            if (j < this.config.leftMin) {
              status = 'exception-left-min';
              reason = `例外显式断点，但词段左侧仅 ${j} 个字母，少于 lefthyphenmin=${this.config.leftMin}`;
            } else if (m - j < this.config.rightMin) {
              status = 'exception-right-min';
              reason = `例外显式断点，但词段右侧仅 ${m - j} 个字母，少于 righthyphenmin=${this.config.rightMin}`;
            } else {
              status = 'exception-break';
              reason =
                seg.exceptionScope === 'whole'
                  ? '整条复合词例外的显式断点，覆盖模式结果'
                  : `词段 "${seg.text}" 的例外显式断点，覆盖模式结果`;
            }
          } else {
            finalScore = 0;
            finalSource =
              seg.exceptionScope === 'whole'
                ? `例外 "${exc.raw}"（整条复合词，未标记）`
                : `词段例外 "${exc.raw}"（未标记）`;
            status = 'exception-blocked';
            reason =
              seg.exceptionScope === 'whole'
                ? '整条复合词例外未在此标记断点，禁止断开（覆盖模式结果）'
                : `词段 "${seg.text}" 的例外未在此标记断点，禁止断开（覆盖模式结果）`;
          }
        } else if (patternScore % 2 === 0) {
          status = 'even';
          reason = patternSource
            ? `最大分值 ${patternScore} 为偶数，不可断`
            : '无模式命中，分值 0（偶数），不可断';
        } else if (j < this.config.leftMin) {
          status = 'left-min';
          reason = `分值 ${patternScore} 为奇数，但词段左侧仅 ${j} 个字母，少于 lefthyphenmin=${this.config.leftMin}`;
        } else if (m - j < this.config.rightMin) {
          status = 'right-min';
          reason = `分值 ${patternScore} 为奇数，但词段右侧仅 ${m - j} 个字母，少于 righthyphenmin=${this.config.rightMin}`;
        } else {
          status = 'break';
          reason = `分值 ${patternScore} 为奇数且通过词段内左右限制，可断`;
        }

        gaps.push({
          gap: g,
          segment: s,
          left: j,
          right: m - j,
          patternScore,
          patternSource,
          exceptionMark,
          finalScore,
          finalSource,
          exceptionSource,
          status,
          breakable: status === 'break' || status === 'exception-break',
          reason,
        });
      }
    }

    gaps.sort((a, b) => a.gap - b.gap);

    const breakPoints = gaps.filter((x) => x.breakable).map((x) => x.gap);
    const breakSet = new Set(breakPoints);
    let hyphenated = '';
    for (let i = 0; i < n; i++) {
      hyphenated += word[i];
      if (breakSet.has(i + 1)) hyphenated += '-';
    }

    const dotted = segInfos.map((seg) => `.${seg.text}.`).join(compound ? ' ' : '');

    return {
      word,
      dotted,
      segments: segInfos,
      gaps,
      breakPoints,
      hyphenated,
      isException: segInfos.some((seg) => seg.exception !== null),
    };
  }
}
