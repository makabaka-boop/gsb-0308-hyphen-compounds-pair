import type { Pattern } from './types';

/** 一个间隙的最大分值及其来源模式序号 */
export interface GapScore {
  score: number;
  /** 贡献最大值的模式序号（Pattern.index）；无命中为 -1 */
  patternIndex: number;
}

interface Terminal {
  slots: (number | null)[];
  index: number;
}

interface TrieNode {
  children: Map<string, TrieNode>;
  /** 以该节点为终点（完整 key 匹配到此处）的模式 */
  terminal: Terminal[];
}

function newNode(): TrieNode {
  return { children: new Map(), terminal: [] };
}

/**
 * 同分值取舍规则（trie 与朴素扫描共用，保证两者结果逐位一致）：
 * 分值更高者胜；并列时取词典中先出现（index 更小）的模式。
 */
export function better(
  value: number,
  index: number,
  best: number[],
  bestIndex: number[],
  gap: number,
): void {
  if (
    value > best[gap] ||
    (value === best[gap] && (bestIndex[gap] === -1 || index < bestIndex[gap]))
  ) {
    best[gap] = value;
    bestIndex[gap] = index;
  }
}

/**
 * 模式 trie：按匹配键（字母 + 两端边界点）建树，
 * 模式的全部分值槽存放在其 key 的终端节点上。
 * 匹配时只有完整走到终端节点的模式才参与计分。
 */
export class PatternTrie {
  private readonly root: TrieNode = newNode();

  constructor(patterns: Pattern[]) {
    for (const p of patterns) this.insert(p);
  }

  private insert(p: Pattern): void {
    let node = this.root;
    for (const c of p.key) {
      let next = node.children.get(c);
      if (!next) {
        next = newNode();
        node.children.set(c, next);
      }
      node = next;
    }
    node.terminal.push({ slots: p.slots, index: p.index });
  }

  /**
   * 对加边界符后的串（长度 n+2）扫描所有对齐位置，
   * 返回词间隙 0..n 的最大分值与来源模式序号。
   * 模式第 j 个间隙（key 下标 j 之前）映射到词间隙 p + j - 1，
   * 其中 p 是模式在 dotted 中的起始下标。
   */
  score(dotted: string, n: number): GapScore[] {
    const best = new Array<number>(n + 1).fill(0);
    const bestIndex = new Array<number>(n + 1).fill(-1);

    for (let p = 0; p < dotted.length; p++) {
      let node = this.root;
      for (let k = p; k < dotted.length; k++) {
        const next = node.children.get(dotted[k]);
        if (!next) break;
        node = next;
        for (const t of node.terminal) {
          for (let j = 0; j < t.slots.length; j++) {
            const v = t.slots[j];
            if (v === null) continue;
            const g = p + j - 1;
            if (g < 0 || g > n) continue;
            better(v, t.index, best, bestIndex, g);
          }
        }
      }
    }

    return best.map((score, i) => ({ score, patternIndex: bestIndex[i] }));
  }
}
