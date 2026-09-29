import { describe, expect, it } from 'vitest';
import {
  exportJSON,
  MAX_WORDS,
  MAX_WORD_LEN,
  parseExceptions,
  parsePatterns,
  parseWords,
  sanitizeConfig,
} from '../src/io';
import { Hyphenator } from '../src/analyze';
import { DEFAULT_EXCEPTIONS, DEFAULT_PATTERNS, DEFAULT_WORDS } from '../src/defaults';

describe('parseExceptions', () => {
  it('解析显式断点位置', () => {
    const { exceptions, errors } = parseExceptions('as-so-ciate\ntable');
    expect(errors).toEqual([]);
    expect(exceptions[0].word).toBe('associate');
    expect([...exceptions[0].breaks].sort((a, b) => a - b)).toEqual([2, 4]);
    expect(exceptions[1].breaks.size).toBe(0);
  });

  it('复合词例外：= 转为固定连接号并计入位置，- 标记可断间隙', () => {
    const { exceptions, errors } = parseExceptions('a-b=c-d');
    expect(errors).toEqual([]);
    expect(exceptions[0].word).toBe('ab-cd');
    // 'a' '-' 后 pos=1；'b' pos=2；'=' pos=3；'c' '-' 后 pos=4；'d' pos=5
    expect([...exceptions[0].breaks].sort((a, b) => a - b)).toEqual([1, 4]);
  });

  it('同词重复时后者覆盖前者', () => {
    const { exceptions } = parseExceptions('table\nta-ble');
    expect(exceptions.length).toBe(1);
    expect(exceptions[0].raw).toBe('ta-ble');
    expect([...exceptions[0].breaks]).toEqual([2]);
  });

  it('拒绝非法字符与超长词，忽略词首词尾连字符', () => {
    const { exceptions, errors } = parseExceptions(`Ab-c\n${'a'.repeat(MAX_WORD_LEN + 1)}\n-ab-`);
    expect(exceptions.map((e) => e.word)).toEqual(['ab']);
    expect(errors.some((e) => e.includes('非法字符'))).toBe(true);
    expect(errors.some((e) => e.includes(`${MAX_WORD_LEN}`))).toBe(true);
    expect(errors.some((e) => e.includes('词首/词尾'))).toBe(true);
  });
});

describe('parseWords', () => {
  it('过滤非法词、去重并限制数量', () => {
    const { words, errors } = parseWords('abc ABC abc def1 ghij');
    expect(words).toEqual(['abc', 'ghij']);
    expect(errors.length).toBe(2);
  });

  it(`拒绝超过 ${MAX_WORD_LEN} 字母的词`, () => {
    const { words, errors } = parseWords('a'.repeat(MAX_WORD_LEN + 1));
    expect(words).toEqual([]);
    expect(errors.length).toBe(1);
  });

  it(`超过 ${MAX_WORDS} 词时截断`, () => {
    const text = Array.from({ length: MAX_WORDS + 3 }, (_, i) => `w${i}x`.replace(/\d/g, (d) => 'abcdefghij'[Number(d)])).join(' ');
    const { words, errors } = parseWords(text);
    expect(words.length).toBe(MAX_WORDS);
    expect(errors.some((e) => e.includes(`${MAX_WORDS}`))).toBe(true);
  });

  it('接受词段间连接号的复合词，拒绝连续/首尾连接号', () => {
    const { words, errors } = parseWords('ab-cd ab-cd-ef -ab ab- cd--ef');
    expect(words).toEqual(['ab-cd', 'ab-cd-ef']);
    expect(errors.length).toBe(3);
  });
});

describe('sanitizeConfig', () => {
  it('限制在 0～40 并取整', () => {
    expect(sanitizeConfig(2.7, -1)).toEqual({ leftMin: 2, rightMin: 0 });
    expect(sanitizeConfig(100, NaN)).toEqual({ leftMin: 40, rightMin: 0 });
  });
});

describe('exportJSON 与高亮一致', () => {
  const { patterns } = parsePatterns(DEFAULT_PATTERNS);
  const { exceptions } = parseExceptions(DEFAULT_EXCEPTIONS);
  const { words } = parseWords(DEFAULT_WORDS);
  const config = { leftMin: 2, rightMin: 2 };
  const h = new Hyphenator(patterns, exceptions, config);
  const results = words.map((w) => h.analyze(w));
  const exported = JSON.parse(exportJSON(results, config, patterns, exceptions)) as {
    words: Array<{
      word: string;
      hyphenated: string;
      breakPoints: number[];
      exception: boolean;
      gaps: Array<{ gap: number; breakable: boolean; finalScore: number }>;
    }>;
  };

  it('逐词 breakPoints 与逐间隙 breakable 一致', () => {
    for (const w of exported.words) {
      const fromGaps = w.gaps.filter((g) => g.breakable).map((g) => g.gap);
      expect(fromGaps, w.word).toEqual(w.breakPoints);
      // 断点不会出现在词边界间隙
      expect(w.breakPoints.every((b) => b >= 1 && b <= w.word.length - 1)).toBe(true);
    }
  });

  it('hyphenated 与 breakPoints 互相吻合', () => {
    for (const w of exported.words) {
      let rebuilt = '';
      const set = new Set(w.breakPoints);
      for (let i = 0; i < w.word.length; i++) {
        rebuilt += w.word[i];
        if (set.has(i + 1)) rebuilt += '-';
      }
      expect(rebuilt, w.word).toBe(w.hyphenated);
      expect(w.hyphenated.replace(/-/g, '')).toBe(w.word);
    }
  });

  it('例外词在导出中带有标记，且断点即例外断点', () => {
    const table = exported.words.find((w) => w.word === 'table');
    expect(table?.exception).toBe(true);
    expect(table?.breakPoints).toEqual([2]); // ta-ble
    const present = exported.words.find((w) => w.word === 'present');
    expect(present?.exception).toBe(true);
    expect(present?.breakPoints).toEqual([]); // 无连字符 → 禁止断字
  });

  it('导出包含词典本身，可完整复现', () => {
    const raw = exportJSON(results, config, patterns, exceptions);
    const parsed = JSON.parse(raw) as { patterns: string[]; exceptions: string[]; config: unknown };
    expect(parsed.patterns.length).toBe(patterns.length);
    expect(parsed.exceptions).toContain('ta-ble');
    expect(parsed.config).toEqual(config);
  });

  it('复合词导出：固定边界可区分、例外来源可对应、三者仍一致', () => {
    const { patterns: p } = parsePatterns('.c1d');
    const { exceptions: e } = parseExceptions('c-d');
    const h = new Hyphenator(p, e, { leftMin: 0, rightMin: 0 });
    const r = h.analyze('ab-cd');
    const parsed = JSON.parse(exportJSON([r], { leftMin: 0, rightMin: 0 }, p, e)) as {
      words: Array<{
        word: string;
        hyphenated: string;
        breakPoints: number[];
        segments: Array<{ text: string; exception: string | null; exceptionScope: string | null }>;
        gaps: Array<{
          gap: number;
          status: string;
          fixedBoundary: boolean;
          breakable: boolean;
          exception: string | null;
          source: string;
        }>;
      }>;
    };
    const w = parsed.words[0];
    expect(w.segments.map((s) => s.text)).toEqual(['ab', 'cd']);
    expect(w.segments[1].exception).toBe('c-d');
    expect(w.segments[1].exceptionScope).toBe('segment');
    // 连接号两侧间隙为固定边界
    const fixed = w.gaps.filter((g) => g.fixedBoundary).map((g) => g.gap);
    expect(fixed).toEqual([2, 3]);
    expect(w.gaps.filter((g) => g.status === 'fixed-boundary')).toHaveLength(2);
    // 段内例外断点的来源能对应到具体例外条目
    expect(w.gaps.find((g) => g.gap === 4)?.exception).toBe('c-d');
    expect(w.gaps.find((g) => g.gap === 4)?.source).toContain('c-d');
    // 一致性不变量仍成立
    expect(w.gaps.filter((g) => g.breakable).map((g) => g.gap)).toEqual(w.breakPoints);
    expect(w.breakPoints).toEqual([4]);
    expect(w.hyphenated).toBe('ab-c-d');
  });
});
