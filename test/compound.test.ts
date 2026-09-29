import { describe, expect, it } from 'vitest';
import { parsePattern } from '../src/pattern';
import { Hyphenator } from '../src/analyze';
import { parseExceptions, parseWords, exportJSON } from '../src/io';
import type { Pattern } from '../src/types';

function makePatterns(raws: string[]): Pattern[] {
  return raws.map((raw, i) => {
    const p = parsePattern(raw, i);
    if (typeof p === 'string') throw new Error(p);
    return p;
  });
}

function makeExceptions(raws: string[]) {
  const { exceptions, errors } = parseExceptions(raws.join('\n'));
  expect(errors).toEqual([]);
  return exceptions;
}

describe('复合词：词段独立计分', () => {
  it('边界模式按词段边界匹配（单独分析与复合词内一致）', () => {
    // .c1d 贴在词首：单独分析 cd 时间隙 1 可断
    const h = new Hyphenator(makePatterns(['.c1d']), [], { leftMin: 0, rightMin: 0 });
    expect(h.analyze('cd').breakPoints).toEqual([1]);
    const r = h.analyze('ab-cd');
    // 复合词内 cd 段首间隙（全局 4）同样可断；ab 段无命中
    expect(r.breakPoints).toEqual([4]);
    expect(r.hyphenated).toBe('ab-c-d');
    expect(r.gaps.map((g) => g.patternScore)).toEqual([0, 0, 0, 0, 1, 0]);
    expect(r.gaps[4].patternSource?.raw).toBe('.c1d');
  });

  it('多段词的每个后段都独立按词段边界匹配', () => {
    const h = new Hyphenator(makePatterns(['.c1d', 'e1f']), [], { leftMin: 0, rightMin: 0 });
    const r = h.analyze('ab-cd-ef');
    expect(r.breakPoints).toEqual([4, 7]); // 全局：c 后(4)、e 后(7)
    expect(r.hyphenated).toBe('ab-c-d-e-f');
  });

  it('词段尾边界模式（如 d1.）在内部词段边缘命中固定边界间隙', () => {
    // d1. 的 1 落在 d 与词段尾边界点之间 → 词段尾间隙
    const plain = new Hyphenator(makePatterns(['d1.']), [], { leftMin: 0, rightMin: 0 });
    expect(plain.analyze('cd').gaps[2].patternScore).toBe(1);
    const h = new Hyphenator(makePatterns(['d1.']), [], { leftMin: 0, rightMin: 0 });
    // ab-cd-ef：cd 段尾（全局间隙 5）是连接号前的固定边界
    const r = h.analyze('ab-cd-ef');
    expect(r.gaps[5].patternScore).toBe(1);
    expect(r.gaps[5].status).toBe('fixed-boundary');
    // 末段 ef 的段尾与全词边缘重合 → 仍是 edge
    expect(r.gaps[8].status).toBe('edge');
    expect(r.breakPoints).toEqual([]);
  });

  it('左右保留字母数按词段独立计算', () => {
    const h = new Hyphenator(makePatterns(['.c1d']), [], { leftMin: 2, rightMin: 0 });
    const r = h.analyze('xxxx-cd');
    // 全局看 c 后间隙左侧有 5 个字母，但词段左侧仅 1 个 → left-min
    expect(r.gaps[6].status).toBe('left-min');
    expect(r.gaps[6].left).toBe(1);
    expect(r.gaps[6].right).toBe(1);
    expect(r.breakPoints).toEqual([]);
  });
});

describe('复合词：固定边界', () => {
  it('连接号两侧间隙标记为 fixed-boundary，左/右取词段边缘值', () => {
    const h = new Hyphenator(makePatterns(['.c1d']), [], { leftMin: 0, rightMin: 0 });
    const r = h.analyze('ab-cd');
    const [g2, g3] = [r.gaps[2], r.gaps[3]];
    expect(g2.status).toBe('fixed-boundary');
    expect(g3.status).toBe('fixed-boundary');
    expect(g2.fixedBoundary).toBe(true);
    expect(g3.fixedBoundary).toBe(true);
    expect([g2.left, g2.right]).toEqual([2, 0]);
    expect([g3.left, g3.right]).toEqual([0, 2]);
    expect(g2.breakable).toBe(false);
    expect(g3.breakable).toBe(false);
    expect(r.fixedBoundaries).toEqual([2, 3]);
  });

  it('多段词的每一处连接号都产生一对固定边界间隙', () => {
    const h = new Hyphenator(makePatterns(['zz9']), [], { leftMin: 0, rightMin: 0 });
    const r = h.analyze('ab-cd-ef');
    expect(r.fixedBoundaries).toEqual([2, 3, 5, 6]);
    expect(r.breakPoints).toEqual([]);
    expect(r.hyphenated).toBe('ab-cd-ef');
  });

  it('固定边界不读任何模式分值以外的状态，永远不可断', () => {
    // 即便模式恰好给段尾奇数值，固定边界仍不可断
    const h = new Hyphenator(makePatterns(['d1.']), makeExceptions(['cd']), {
      leftMin: 0,
      rightMin: 0,
    });
    const r = h.analyze('ab-cd');
    expect(r.gaps[2].status).toBe('fixed-boundary');
    expect(r.gaps[3].status).toBe('fixed-boundary');
    expect(r.breakPoints).toEqual([]);
  });
});

describe('复合词：例外（= 固定连接号）', () => {
  it('整条复合例外的断点按全局编号生效，限制按词段判定', () => {
    // a-b=c-d：输入 ab-cd；断点 1（a|b）与 4（c|d），连接号在 2/3 固定
    const exceptions = makeExceptions(['a-b=c-d']);
    expect(exceptions[0].word).toBe('ab-cd');
    expect([...exceptions[0].breaks]).toEqual([1, 4]);

    const h = new Hyphenator(makePatterns(['.c1d']), exceptions, { leftMin: 2, rightMin: 0 });
    const r = h.analyze('ab-cd');
    expect(r.isException).toBe(true);
    // 两个词段左边都只有 1 个字母 → 即使全局左字母数足够也被排除
    expect(r.gaps[1].status).toBe('exception-left-min');
    expect(r.gaps[4].status).toBe('exception-left-min');
    expect(r.gaps[1].left).toBe(1);
    expect(r.gaps[4].left).toBe(1);
    expect(r.breakPoints).toEqual([]);
  });

  it('leftMin=0 时整条例外标记处可断，固定边界仍不可断', () => {
    const h = new Hyphenator(
      makePatterns(['.c1d']),
      makeExceptions(['a-b=c-d']),
      { leftMin: 0, rightMin: 0 },
    );
    const r = h.analyze('ab-cd');
    expect(r.breakPoints).toEqual([1, 4]);
    expect(r.hyphenated).toBe('a-b-c-d');
    expect(r.fixedBoundaries).toEqual([2, 3]);
  });

  it('整条例外覆盖各词段自身的例外与模式', () => {
    const h = new Hyphenator(
      makePatterns(['.c1d']),
      makeExceptions(['c-d', 'ab=cd']), // 词段级 c-d 与整条 ab=cd（无断点）
      { leftMin: 0, rightMin: 0 },
    );
    const r = h.analyze('ab-cd');
    // 整条例外无断点标记 → 全部禁止，包括模式本来可断的 c|d
    expect(r.breakPoints).toEqual([]);
    expect(r.gaps[4].status).toBe('exception-blocked');
    expect(r.gaps[4].finalSource).toContain('复合词例外 "ab=cd"');
  });

  it('无整条例外时各词段独立使用自己的例外条目', () => {
    const h = new Hyphenator(
      makePatterns(['.c1d']),
      makeExceptions(['c-d']),
      { leftMin: 0, rightMin: 0 },
    );
    const r = h.analyze('ab-cd-ef');
    expect(r.isException).toBe(true);
    // cd 段命中词段例外（与模式结论相同）；ab/ef 段走模式
    expect(r.breakPoints).toEqual([4]);
    expect(r.gaps[4].status).toBe('exception-break');
    expect(r.gaps[4].finalSource).toContain('词段例外 "c-d"');
    expect(r.gaps[4].finalSource).toContain('词段 "cd"');
    // 没有对应词段例外的间隙走普通模式分支
    expect(r.gaps[1].finalSource).toBe('无模式命中');
  });

  it('无连字符的整条例外禁止一切非固定间隙断字', () => {
    const h = new Hyphenator(
      makePatterns(['.c1d']),
      makeExceptions(['ab=cd']),
      { leftMin: 0, rightMin: 0 },
    );
    const r = h.analyze('ab-cd');
    for (const g of r.gaps) {
      if (g.status === 'fixed-boundary' || g.status === 'edge') continue;
      expect(g.status).toBe('exception-blocked');
    }
    expect(r.breakPoints).toEqual([]);
  });
});

describe('复合词：例外解析校验', () => {
  it('拒绝连续连接号', () => {
    const { exceptions, errors } = parseExceptions('a--b=c\na=b==c');
    expect(exceptions).toEqual([]);
    expect(errors.length).toBe(2);
    expect(errors.every((e) => e.includes('连续连接号'))).toBe(true);
  });

  it('词首词尾连接号告警后忽略标记，仍可用于匹配输入', () => {
    const { exceptions, errors } = parseExceptions('=ab-\n-ab=');
    expect(exceptions.map((e) => e.word)).toEqual(['-ab', 'ab-']);
    expect(errors.length).toBe(2);
    expect(errors.every((e) => e.includes('词首/词尾'))).toBe(true);
  });

  it('断点在 "=" 之前也能正确归一并定位', () => {
    const { exceptions, errors } = parseExceptions('a-b=c-d\nx=y-z');
    expect(errors).toEqual([]);
    expect(exceptions[0].word).toBe('ab-cd');
    expect([...exceptions[0].breaks]).toEqual([1, 4]);
    expect(exceptions[1].word).toBe('x-yz');
    expect([...exceptions[1].breaks]).toEqual([3]);
  });
});

describe('复合词：导出 JSON', () => {
  const patterns = makePatterns(['.c1d', 'e1f']);
  const exceptions = makeExceptions(['a-b=c-d']);
  const config = { leftMin: 0, rightMin: 0 };
  const h = new Hyphenator(patterns, exceptions, config);
  const results = parseWords('ab-cd-ef').words.map((w) => h.analyze(w));
  const exported = JSON.parse(exportJSON(results, config, patterns, exceptions)) as {
    words: Array<{
      word: string;
      hyphenated: string;
      breakPoints: number[];
      fixedBoundaries: number[];
      gaps: Array<{ gap: number; status: string; breakable: boolean; fixedBoundary: boolean }>;
    }>;
  };

  it('breakPoints 与逐间隙 breakable 一致，且不含固定边界', () => {
    for (const w of exported.words) {
      const fromGaps = w.gaps.filter((g) => g.breakable).map((g) => g.gap);
      expect(fromGaps).toEqual(w.breakPoints);
      expect(w.breakPoints.some((b) => w.fixedBoundaries.includes(b))).toBe(false);
    }
  });

  it('固定边界在导出中可与普通边界区分', () => {
    const w = exported.words[0];
    expect(w.fixedBoundaries).toEqual([2, 3, 5, 6]);
    expect(w.gaps.filter((g) => g.status === 'fixed-boundary').map((g) => g.gap)).toEqual([
      2, 3, 5, 6,
    ]);
    expect(w.gaps.every((g) => g.fixedBoundary === (g.status === 'fixed-boundary'))).toBe(true);
  });

  it('hyphenated 去掉插入连字符后仍以固定连接号还原原词', () => {
    const w = exported.words[0];
    // 插入的断字连字符出现在可断间隙；固定连接号始终保留
    expect(w.hyphenated.includes('-')).toBe(true);
    const fixedCount = (w.word.match(/-/g) ?? []).length;
    const totalHyphens = (w.hyphenated.match(/-/g) ?? []).length;
    expect(totalHyphens).toBe(fixedCount + w.breakPoints.length);
  });
});
