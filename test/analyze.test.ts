import { describe, expect, it } from 'vitest';
import { parsePattern } from '../src/pattern';
import { Hyphenator, EXCEPTION_SCORE } from '../src/analyze';
import { parseExceptions } from '../src/io';
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

const CFG = { leftMin: 2, rightMin: 2 };

/** The TeXbook 附录 H 的经典示例词 */
const TEXBOOK_PATTERNS = ['hy3ph', 'he2n', 'hen5at', '1na', 'n2at', '1tio', 'o2n'];

describe('Hyphenator 模式判定', () => {
  it('重叠规则：逐间隙取最大值，奇数且过限制才可断', () => {
    const h = new Hyphenator(makePatterns(TEXBOOK_PATTERNS), [], CFG);
    const r = h.analyze('hyphenation');
    expect(r.gaps.map((g) => g.patternScore)).toEqual(
      [0, 0, 3, 0, 0, 2, 5, 1, 0, 0, 2, 0],
    );
    // 间隙 5：he2n(2) 与 1na(1) 重叠 → 最大值来自 he2n
    expect(r.gaps[5].patternSource?.raw).toBe('he2n');
    // 间隙 6：hen5at(5) 与 n2at(2) 重叠 → 最大值来自 hen5at
    expect(r.gaps[6].patternSource?.raw).toBe('hen5at');
    expect(r.breakPoints).toEqual([2, 6, 7]);
    expect(r.hyphenated).toBe('hy-phen-a-tion');
    expect(r.gaps[5].status).toBe('even');
    expect(r.gaps[5].reason).toContain('偶数');
  });

  it('词边界间隙即使分值为奇也不可断', () => {
    const h = new Hyphenator(makePatterns(['.hy2', 'on3.', '5abcdefgh']), [], CFG);
    const r = h.analyze('hyphenation');
    expect(r.gaps[0].status).toBe('edge');
    expect(r.gaps[11].status).toBe('edge');
    expect(r.gaps[11].patternScore).toBe(3); // on3. 命中词尾
    expect(r.gaps[11].breakable).toBe(false);
    expect(r.breakPoints).toEqual([]);
  });

  it('左右最少保留字母数排除奇数间隙并给出原因', () => {
    const h = new Hyphenator(makePatterns(['a1b', 'd1e']), [], CFG);
    const r = h.analyze('abcde');
    expect(r.gaps[1].status).toBe('left-min');
    expect(r.gaps[1].reason).toContain('lefthyphenmin=2');
    expect(r.gaps[4].status).toBe('right-min');
    expect(r.gaps[4].reason).toContain('righthyphenmin=2');
    expect(r.breakPoints).toEqual([]);

    const loose = new Hyphenator(makePatterns(['a1b', 'd1e']), [], { leftMin: 1, rightMin: 1 });
    const r2 = loose.analyze('abcde');
    expect(r2.breakPoints).toEqual([1, 4]);
    expect(r2.hyphenated).toBe('a-bcd-e');
  });

  it('无断点词：无命中时间隙分值为 0（偶数）', () => {
    const h = new Hyphenator(makePatterns(['z9z']), [], CFG);
    const r = h.analyze('qwerty');
    expect(r.breakPoints).toEqual([]);
    expect(r.hyphenated).toBe('qwerty');
    expect(r.gaps.slice(1, -1).every((g) => g.status === 'even')).toBe(true);
    expect(r.gaps[3].patternSource).toBeNull();
    expect(r.gaps[3].finalSource).toBe('无模式命中');
  });
});

describe('Hyphenator 例外词覆盖', () => {
  it('显式断点覆盖模式结果：禁止未标记间隙、新增标记间隙', () => {
    const h = new Hyphenator(
      makePatterns(TEXBOOK_PATTERNS),
      makeExceptions(['hyph-en-ation']), // 禁止间隙 2、7，新增间隙 4，保留间隙 6
      CFG,
    );
    const r = h.analyze('hyphenation');
    expect(r.isException).toBe(true);
    expect(r.breakPoints).toEqual([4, 6]);
    expect(r.hyphenated).toBe('hyph-en-ation');
    // 模式原本在间隙 2 给出奇数 3，但例外未标记 → 禁止
    expect(r.gaps[2].patternScore).toBe(3);
    expect(r.gaps[2].finalScore).toBe(0);
    expect(r.gaps[2].status).toBe('exception-blocked');
    expect(r.gaps[2].reason).toContain('例外');
    // 间隙 4 模式分值 0（偶数），例外标记 → 以哨兵分值放行
    expect(r.gaps[4].patternScore).toBe(0);
    expect(r.gaps[4].finalScore).toBe(EXCEPTION_SCORE);
    expect(r.gaps[4].status).toBe('exception-break');
    expect(r.gaps[4].finalSource).toContain('例外');
  });

  it('无连字符的例外词禁止一切断字', () => {
    const h = new Hyphenator(makePatterns(TEXBOOK_PATTERNS), makeExceptions(['hyphenation']), CFG);
    const r = h.analyze('hyphenation');
    expect(r.breakPoints).toEqual([]);
    expect(r.hyphenated).toBe('hyphenation');
    expect(r.gaps.slice(1, -1).every((g) => g.status === 'exception-blocked')).toBe(true);
  });

  it('例外断点同样受左右限制约束', () => {
    const h = new Hyphenator(makePatterns(['a1b']), makeExceptions(['a-b']), {
      leftMin: 2,
      rightMin: 2,
    });
    const r = h.analyze('ab');
    expect(r.gaps[1].exceptionMark).toBe(true);
    expect(r.gaps[1].status).toBe('exception-left-min');
    expect(r.gaps[1].breakable).toBe(false);
    expect(r.gaps[1].reason).toContain('lefthyphenmin');

    const h2 = new Hyphenator(makePatterns(['a1b']), makeExceptions(['a-b']), {
      leftMin: 1,
      rightMin: 1,
    });
    expect(h2.analyze('ab').breakPoints).toEqual([1]);
  });

  it('例外只影响完全相同的词', () => {
    const h = new Hyphenator(makePatterns(TEXBOOK_PATTERNS), makeExceptions(['hy-phen-ation']), CFG);
    const other = h.analyze('hyphenations');
    expect(other.isException).toBe(false);
  });
});

describe('Hyphenator 复合词逐词段判定', () => {
  it('带边界符的模式按各词段独立加点后命中（与单词段分析一致）', () => {
    const h = new Hyphenator(makePatterns(['.c1d']), [], { leftMin: 0, rightMin: 0 });
    const single = h.analyze('cd');
    const comp = h.analyze('ab-cd');
    expect(single.breakPoints).toEqual([1]);
    // 后段 c|d 的断点在全局间隙 4（连接号占全局间隙 2/3）
    expect(comp.breakPoints).toEqual([4]);
    expect(comp.hyphenated).toBe('ab-c-d');
    expect(comp.gaps[4].status).toBe('break');
    expect(comp.gaps[4].patternSource?.raw).toBe('.c1d');
  });

  it('多段词中每个后段的边界模式都能命中', () => {
    const h = new Hyphenator(makePatterns(['.c1d', '.e1f']), [], { leftMin: 0, rightMin: 0 });
    const r = h.analyze('ab-cd-ef');
    expect(r.breakPoints).toEqual([4, 7]);
    expect(r.hyphenated).toBe('ab-c-d-e-f');
    expect(r.segments.map((s) => s.text)).toEqual(['ab', 'cd', 'ef']);
  });

  it('连接号两侧间隙标记为固定边界，永不参与断字，且编号沿原输入串', () => {
    const h = new Hyphenator(makePatterns(['.c1d']), [], { leftMin: 0, rightMin: 0 });
    const r = h.analyze('ab-cd');
    expect(r.gaps.map((g) => g.status)).toEqual([
      'edge',
      'even',
      'fixed-boundary',
      'fixed-boundary',
      'break',
      'edge',
    ]);
    for (const g of r.gaps) {
      if (g.status === 'fixed-boundary') {
        expect(g.breakable).toBe(false);
        expect(g.finalScore).toBe(0);
        expect(g.reason).toContain('固定');
      }
    }
    expect(r.breakPoints).not.toContain(2);
    expect(r.breakPoints).not.toContain(3);
    // 固定边界处的段内左/右字母数为 0
    expect(r.gaps[2].left).toBe(2);
    expect(r.gaps[2].right).toBe(0);
    expect(r.gaps[3].left).toBe(0);
    expect(r.gaps[3].right).toBe(2);
    expect(r.dotted).toBe('.ab. .cd.');
  });

  it('整条复合词例外覆盖各段，且左右保留数按词段局部判定', () => {
    const h = new Hyphenator(
      makePatterns([]),
      makeExceptions(['a-b=c-d']), // 对应输入 ab-cd；标记全局间隙 1 与 4
      { leftMin: 2, rightMin: 0 },
    );
    const r = h.analyze('ab-cd');
    expect(r.isException).toBe(true);
    // 两个标记断点在各自词段内左侧都只有 1 个字母 → 均被 leftMin 排除
    expect(r.gaps[1].status).toBe('exception-left-min');
    expect(r.gaps[4].status).toBe('exception-left-min');
    expect(r.breakPoints).toEqual([]);
    // 固定边界仍优先于例外，且来源不被误记为例外
    expect(r.gaps[2].status).toBe('fixed-boundary');
    expect(r.gaps[3].status).toBe('fixed-boundary');

    const loose = new Hyphenator(makePatterns([]), makeExceptions(['a-b=c-d']), {
      leftMin: 1,
      rightMin: 1,
    });
    expect(loose.analyze('ab-cd').breakPoints).toEqual([1, 4]);
  });

  it('无整条例外时各词段独立使用自己的例外条目，来源可对应', () => {
    const h = new Hyphenator(makePatterns([]), makeExceptions(['c-d']), {
      leftMin: 0,
      rightMin: 0,
    });
    const r = h.analyze('ab-cd');
    expect(r.isException).toBe(true);
    expect(r.segments[0].exception).toBeNull();
    expect(r.segments[1].exception?.raw).toBe('c-d');
    expect(r.segments[1].exceptionScope).toBe('segment');
    expect(r.breakPoints).toEqual([4]);
    expect(r.gaps[4].status).toBe('exception-break');
    expect(r.gaps[4].finalSource).toContain('c-d');
    expect(r.gaps[4].exceptionSource).toBe('c-d');
    // 未标记的段内间隙被该段例外禁止
    expect(r.gaps[3].status).toBe('fixed-boundary');
  });

  it('整条复合词例外优先于词段自身例外', () => {
    const h = new Hyphenator(
      makePatterns(['.c1d']),
      makeExceptions(['c-d', 'ab=cd']), // 整条例外无断点 → 禁止一切断字
      { leftMin: 0, rightMin: 0 },
    );
    const r = h.analyze('ab-cd');
    expect(r.segments[1].exception?.raw).toBe('ab=cd');
    expect(r.segments[1].exceptionScope).toBe('whole');
    // 模式在 gap 4 给出奇数 1，但整条例外未标记 → 禁止
    expect(r.gaps[4].patternScore).toBe(1);
    expect(r.gaps[4].status).toBe('exception-blocked');
    expect(r.breakPoints).toEqual([]);
  });
});
