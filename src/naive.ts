import type { Pattern } from './types';
import { better, type GapScore } from './trie';

/**
 * 朴素逐模式扫描（参考实现，用于与 PatternTrie 对拍）：
 * 每条模式在加边界符后的串上枚举所有对齐位置，逐字符比较
 * （边界点只与串两端的 '.' 相等，因此带点的模式自然只能贴在对应边界）。
 */
export function naiveScore(patterns: Pattern[], dotted: string, n: number): GapScore[] {
  const best = new Array<number>(n + 1).fill(0);
  const bestIndex = new Array<number>(n + 1).fill(-1);

  for (const p of patterns) {
    const L = p.key.length;
    for (let pos = 0; pos + L <= dotted.length; pos++) {
      let ok = true;
      for (let k = 0; k < L; k++) {
        if (p.key[k] !== dotted[pos + k]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      for (let j = 0; j <= L; j++) {
        const v = p.slots[j];
        if (v === null) continue;
        const g = pos + j - 1;
        if (g < 0 || g > n) continue;
        better(v, p.index, best, bestIndex, g);
      }
    }
  }

  return best.map((score, i) => ({ score, patternIndex: bestIndex[i] }));
}
