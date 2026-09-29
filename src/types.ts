/**
 * 断字词典核心类型。
 *
 * 间隙（gap）编号约定：对长度为 n 的词，间隙 0..n 共 n+1 个，
 * 间隙 g 位于第 g 个字母之后（间隙 0 在词首之前，间隙 n 在词尾之后）。
 * 加上边界符后的串 ".word." 中，间隙 g 恰好位于下标 g 与 g+1 之间。
 */

/** 一条断字模式，如 "hy3ph"、".ach4"、"tion." */
export interface Pattern {
  /** 原始输入文本 */
  raw: string;
  /** 去掉数字后的匹配键（保留两端边界点），如 ".hyph" */
  key: string;
  /** 匹配键中的字母部分 */
  letters: string;
  hasLeadingDot: boolean;
  hasTrailingDot: boolean;
  /**
   * slots[j] 对应 key 的第 j 个间隙（0..key.length）的数字权重；
   * null 表示该间隙无数字。每个间隙至多一位 0～9。
   */
  slots: (number | null)[];
  /** 在词典中的序号，用于同分值时的稳定取舍与界面展示 */
  index: number;
}

/** 例外词条目，如 "as-so-ciate" */
export interface ExceptionWord {
  /** 原始输入文本（含显式断点连字符） */
  raw: string;
  /** 去掉连字符后的词 */
  word: string;
  /** 显式断点间隙集合（相对 word，取值 1..n-1） */
  breaks: Set<number>;
  index: number;
}

/** 间隙最终状态 */
export type GapStatus =
  | 'break' // 奇数分值且通过左右限制：可断
  | 'even' // 偶数分值（含 0 / 无命中）：不可断
  | 'left-min' // 奇数但左侧保留字母不足
  | 'right-min' // 奇数但右侧保留字母不足
  | 'edge' // 整条词首尾的词边界间隙（0 或 n），永不参与断字
  | 'fixed-boundary' // 复合词连接号两侧的词段边缘间隙，固定不可断
  | 'exception-break' // 例外词显式断点：可断
  | 'exception-blocked' // 例外词未标记的间隙：禁止断开
  | 'exception-left-min' // 例外断点但左侧保留不足
  | 'exception-right-min'; // 例外断点但右侧保留不足

/** 复合词的一个词段（按连接号切分） */
export interface SegmentInfo {
  /** 词段序号，从 0 开始 */
  index: number;
  /** 词段文本（不含连接号） */
  text: string;
  /** 词段首字母在原输入串中的下标 */
  start: number;
  /** 词段长度（字母数） */
  length: number;
  /** 对该词段生效的例外条目（整条词例外或词段自身例外），无则为 null */
  exception: ExceptionWord | null;
  /** 生效例外的来源：整条复合词例外，或该词段自身的例外 */
  exceptionScope: 'whole' | 'segment' | null;
}

/** 单个间隙的完整判定结果 */
export interface GapInfo {
  /** 间隙编号 0..n（沿含连接号的原输入串统一编号） */
  gap: number;
  /** 所属词段序号；词首间隙 0 属于第一段 */
  segment: number;
  /** 左侧字母数：段内判定时为距词段左缘的字母数（固定边界处为 0） */
  left: number;
  /** 右侧字母数：段内判定时为距词段右缘的字母数（固定边界处为 0） */
  right: number;
  /** 模式匹配分值：该词段内所有命中模式在该间隙权重的最大值（无命中为 0） */
  patternScore: number;
  /** 贡献该最大值的模式（同分值并列时取词典中先出现者；无命中为 null） */
  patternSource: Pattern | null;
  /** 例外词是否在此显式标记断点 */
  exceptionMark: boolean;
  /** 最终生效分值（例外覆盖后：显式断点为 9，被例外禁止/固定边界为 0） */
  finalScore: number;
  /** 最终生效来源的人类可读描述 */
  finalSource: string;
  /** 覆盖该间隙的例外条目原始文本（无例外覆盖为 null），供导出对应来源 */
  exceptionSource: string | null;
  status: GapStatus;
  breakable: boolean;
  /** 被限制规则排除的原因 / 可断依据（中文，界面直接展示） */
  reason: string;
}

/** 一个词的完整分析结果 */
export interface WordResult {
  word: string;
  /** 加边界符后的串；复合词为各词段独立加点后以空格分隔，如 ".ab. .cd." */
  dotted: string;
  /** 按连接号切分的词段信息（普通单词只有一段） */
  segments: SegmentInfo[];
  gaps: GapInfo[];
  /** 可断间隙列表（升序，编号沿原输入串） */
  breakPoints: number[];
  /** 插入断点连字符后的形式，如 "hy-phen-ation" */
  hyphenated: string;
  /** 整条词或任一词段命中了例外条目 */
  isException: boolean;
}

export interface DictionaryConfig {
  /** 左侧最少保留字母数（lefthyphenmin） */
  leftMin: number;
  /** 右侧最少保留字母数（righthyphenmin） */
  rightMin: number;
}
