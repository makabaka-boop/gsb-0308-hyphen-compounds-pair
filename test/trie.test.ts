import { describe, expect, it } from 'vitest';
import { parsePattern } from '../src/pattern';
import { PatternTrie } from '../src/trie';
import { naiveScore } from '../src/naive';
import type { Pattern } from '../src/types';

function makePatterns(raws: string[]): Pattern[] {
  return raws.map((raw, i) => {
    const p = parsePattern(raw, i);
    if (typeof p === 'string') throw new Error(p);
    return p;
  });
}

function scoresOf(patterns: Pattern[], word: string) {
  const n = word.length;
  const dotted = `.${word}.`;
  const trie = new PatternTrie(patterns).score(dotted, n);
  const naive = naiveScore(patterns, dotted, n);
  return { trie, naive };
}

describe('PatternTrie 与朴素扫描对拍', () => {
  it('重叠规则取各间隙最大值，来源取并列中先出现者', () => {
    const patterns = makePatterns(['a1b2c', 'b3c4d', 'c5d5e']);
    const { trie, naive } = scoresOf(patterns, 'abcde');
    expect(trie).toEqual(naive);
    expect(trie.map((s) => s.score)).toEqual([0, 1, 3, 5, 5, 0]);
    // 间隙 2：a1b2c 给 2、b3c4d 给 3 → 最大值来自 b3c4d（index 1）
    expect(trie[2].patternIndex).toBe(1);
    // 间隙 3：b3c4d 给 4、c5d5e 给 5 → 来自 c5d5e（index 2）
    expect(trie[3].patternIndex).toBe(2);
  });

  it('同分值并列时来源为先出现的模式', () => {
    const patterns = makePatterns(['a3b', 'z3a', 'ab3', 'b3c']);
    // a3b 与 b3c 都会在 "abc" 的间隙 1/2 给出 3
    const { trie, naive } = scoresOf(patterns, 'abc');
    expect(trie).toEqual(naive);
    expect(trie[1].score).toBe(3);
    expect(trie[1].patternIndex).toBe(0); // a3b 先于 b3c
    expect(trie[2].score).toBe(3);
    expect(trie[2].patternIndex).toBe(2); // ab3 先于 b3c
  });

  it('边界模式只贴在对应边界', () => {
    const patterns = makePatterns(['.hy2', 'on3.', '.5abc', 'xyz9']);
    const hit = scoresOf(patterns, 'hyphenation');
    expect(hit.trie).toEqual(hit.naive);
    // ".hy2"：key ".hy"，数字 2 在 y 之后 → 词间隙 2
    expect(hit.trie[2].score).toBe(2);
    // "on3."：key "on."，数字 3 在 on 与尾点之间 → 词间隙 n（词尾）
    expect(hit.trie[11].score).toBe(3);
    // 词中间的 "hy"/"on" 不应命中边界模式
    const mid = scoresOf(patterns, 'ahybonx');
    expect(mid.trie).toEqual(mid.naive);
    expect(mid.trie.every((s) => s.score === 0)).toBe(true);
  });

  it('模式首间隙数字映射到词间隙 p-1', () => {
    const patterns = makePatterns(['5ab', '1tio']);
    const { trie, naive } = scoresOf(patterns, 'xabtio');
    expect(trie).toEqual(naive);
    // "5ab" 从下标 2 的 a 开始对齐 → 词间隙 1
    expect(trie[1].score).toBe(5);
    // "1tio" 从下标 4 的 t 对齐 → 词间隙 3
    expect(trie[3].score).toBe(1);
  });

  it('随机模式与随机词批量对拍', () => {
    let seed = 20260926;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    const raws = new Set<string>();
    const maybeDigit = () => (rand() < 0.35 ? String(Math.floor(rand() * 10)) : '');
    while (raws.size < 300) {
      let raw = maybeDigit(); // 首间隙
      if (rand() < 0.25) raw += '.';
      const len = 1 + Math.floor(rand() * 5);
      for (let i = 0; i < len; i++) {
        raw += String.fromCharCode(97 + Math.floor(rand() * 8));
        if (i < len - 1) raw += maybeDigit(); // 字母间间隙，至多一位
      }
      if (rand() < 0.25) raw += '.';
      raw += maybeDigit(); // 尾间隙（尾点之后是独立间隙，不冲突）
      raws.add(raw);
    }
    const patterns = makePatterns([...raws]);
    const trie = new PatternTrie(patterns);
    for (let w = 0; w < 300; w++) {
      const n = 1 + Math.floor(rand() * 12);
      let word = '';
      for (let i = 0; i < n; i++) word += String.fromCharCode(97 + Math.floor(rand() * 8));
      const dotted = `.${word}.`;
      expect(trie.score(dotted, n), `word=${word}`).toEqual(naiveScore(patterns, dotted, n));
    }
  });
});
