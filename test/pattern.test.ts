import { describe, expect, it } from 'vitest';
import { parsePattern } from '../src/pattern';
import { parsePatterns, MAX_PATTERNS } from '../src/io';

describe('parsePattern', () => {
  it('解析普通模式并定位间隙数字', () => {
    const p = parsePattern('hy3ph', 0);
    expect(p).not.toBeTypeOf('string');
    if (typeof p === 'string') return;
    expect(p.key).toBe('hyph');
    expect(p.letters).toBe('hyph');
    expect(p.slots).toEqual([null, null, 3, null, null]);
    expect(p.hasLeadingDot).toBe(false);
    expect(p.hasTrailingDot).toBe(false);
  });

  it('解析两端边界符与边界间隙数字', () => {
    const p = parsePattern('5.ab3c.', 0);
    if (typeof p === 'string') throw new Error(p);
    expect(p.key).toBe('.abc.');
    // key 长度 5 → 6 个间隙槽；5 在首点之前，3 在 c 与尾点之间
    expect(p.slots).toEqual([5, null, null, 3, null, null]);
    expect(p.hasLeadingDot).toBe(true);
    expect(p.hasTrailingDot).toBe(true);
  });

  it('尾点之后也允许一位数字（落入词尾间隙之外，无害）', () => {
    const p = parsePattern('.abc.5', 0);
    if (typeof p === 'string') throw new Error(p);
    expect(p.key).toBe('.abc.');
    expect(p.slots[5]).toBe(5);
  });

  it('首尾间隙（含边界点外侧）均可带数字', () => {
    const p = parsePattern('1tio', 0);
    if (typeof p === 'string') throw new Error(p);
    expect(p.slots[0]).toBe(1);
    const q = parsePattern('on3.', 0);
    if (typeof q === 'string') throw new Error(q);
    expect(q.slots).toEqual([null, null, 3, null]);
  });

  it('无数字模式合法（仅作匹配，不产生分值）', () => {
    const p = parsePattern('abc', 0);
    if (typeof p === 'string') throw new Error(p);
    expect(p.slots).toEqual([null, null, null, null]);
  });

  it('拒绝非法形式', () => {
    expect(parsePattern('a12b', 0)).toMatch(/同一间隙/);
    expect(parsePattern('ab.cd', 0)).toMatch(/两端/);
    expect(parsePattern('aB3', 0)).toMatch(/非法字符/);
    expect(parsePattern('123', 0)).toMatch(/不含字母/);
    expect(parsePattern('..', 0)).toMatch(/不含字母/);
    expect(parsePattern('a-b', 0)).toMatch(/非法字符/);
  });
});

describe('parsePatterns', () => {
  it('去重并保留先出现者', () => {
    const { patterns, errors } = parsePatterns('hy3ph\nhe2n\nhy3ph\n');
    expect(patterns.map((p) => p.raw)).toEqual(['hy3ph', 'he2n']);
    expect(errors.some((e) => e.includes('重复'))).toBe(true);
  });

  it('跳过非法行并保留其余', () => {
    const { patterns, errors } = parsePatterns('hy3ph\nBAD!\nhe2n');
    expect(patterns.map((p) => p.raw)).toEqual(['hy3ph', 'he2n']);
    expect(errors.length).toBe(1);
  });

  it(`超过 ${MAX_PATTERNS} 条时截断并告警`, () => {
    // 用纯字母的不同组合生成 1005 条互不重复的合法模式
    const text = Array.from({ length: MAX_PATTERNS + 5 }, (_, i) => {
      let s = '';
      let v = i;
      do {
        s = String.fromCharCode(97 + (v % 26)) + s;
        v = Math.floor(v / 26) - 1;
      } while (v >= 0);
      return s;
    }).join('\n');
    const { patterns, errors } = parsePatterns(text);
    expect(patterns.length).toBe(MAX_PATTERNS);
    expect(errors.some((e) => e.includes(`${MAX_PATTERNS}`))).toBe(true);
  });

  it('空词典报错', () => {
    const { errors } = parsePatterns('# 只有注释\n');
    expect(errors.some((e) => e.includes('至少需要 1 条'))).toBe(true);
  });
});
