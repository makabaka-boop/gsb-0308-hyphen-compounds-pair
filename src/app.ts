import './styles.css';
import { DEFAULT_EXCEPTIONS, DEFAULT_PATTERNS, DEFAULT_WORDS } from './defaults';
import {
  exportJSON,
  MAX_PATTERNS,
  MAX_WORDS,
  parseExceptions,
  parsePatterns,
  parseWords,
  sanitizeConfig,
} from './io';
import { Hyphenator } from './analyze';
import type { GapInfo, GapStatus, WordResult } from './types';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

const patternsEl = $<HTMLTextAreaElement>('patterns');
const exceptionsEl = $<HTMLTextAreaElement>('exceptions');
const wordsEl = $<HTMLTextAreaElement>('words');
const leftMinEl = $<HTMLInputElement>('leftMin');
const rightMinEl = $<HTMLInputElement>('rightMin');
const messagesEl = $('messages');
const outEl = $('words-out');
const patternsCountEl = $('patterns-count');
const exceptionsCountEl = $('exceptions-count');
const wordsCountEl = $('words-count');

/** 当前一次计算的结果；渲染、详情与导出共用这一份，保证高亮与 JSON 一致 */
let currentResults: WordResult[] = [];
/** 已导出的 JSON 文本（与 currentResults 同源生成） */
let lastJSON = '';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function compute(): void {
  const { patterns, errors: pErr } = parsePatterns(patternsEl.value);
  const { exceptions, errors: eErr } = parseExceptions(exceptionsEl.value);
  const { words, errors: wErr } = parseWords(wordsEl.value);
  const config = sanitizeConfig(Number(leftMinEl.value), Number(rightMinEl.value));

  patternsCountEl.textContent = `${patterns.length}/${MAX_PATTERNS}`;
  exceptionsCountEl.textContent = `${exceptions.length}`;
  wordsCountEl.textContent = `${words.length}/${MAX_WORDS}`;

  messagesEl.innerHTML = [
    ...pErr.map((t) => `<div class="msg msg-error">${escapeHtml(t)}</div>`),
    ...eErr.map((t) => `<div class="msg msg-error">${escapeHtml(t)}</div>`),
    ...wErr.map((t) => `<div class="msg msg-warn">${escapeHtml(t)}</div>`),
  ].join('');

  const hyphenator = new Hyphenator(patterns, exceptions, config);
  currentResults = words.map((w) => hyphenator.analyze(w));
  lastJSON = exportJSON(currentResults, config, patterns, exceptions);
  render();
}

function chipClass(status: GapStatus): string {
  switch (status) {
    case 'break': return 'st-break';
    case 'exception-break': return 'st-exception-break';
    case 'left-min':
    case 'right-min':
    case 'exception-left-min':
    case 'exception-right-min': return 'st-min';
    case 'even': return 'st-even';
    case 'exception-blocked': return 'st-exception-blocked';
    case 'edge': return 'st-edge';
  }
}

function statusText(s: GapStatus): string {
  switch (s) {
    case 'break': return '可断';
    case 'exception-break': return '例外断点';
    case 'left-min':
    case 'exception-left-min': return '左侧不足';
    case 'right-min':
    case 'exception-right-min': return '右侧不足';
    case 'even': return '偶数分值';
    case 'exception-blocked': return '例外禁止';
    case 'edge': return '词边界';
  }
}

function titleFor(g: GapInfo): string {
  return (
    `间隙 ${g.gap}：左 ${g.left} / 右 ${g.right}，` +
    `模式分值 ${g.patternScore}（${g.patternSource ? g.patternSource.raw : '无命中'}），` +
    `最终分值 ${g.finalScore}\n${g.reason}`
  );
}

function render(): void {
  if (currentResults.length === 0) {
    outEl.innerHTML = '<p class="hint">没有可分析的词条。</p>';
    return;
  }
  outEl.innerHTML = currentResults
    .map((r) => {
      let cells = '';
      for (let i = 0; i < r.word.length; i++) {
        const g = r.gaps[i];
        cells += chipHtml(r.word, g);
        cells += `<span class="letter">${r.word[i]}</span>`;
      }
      cells += chipHtml(r.word, r.gaps[r.word.length]);

      return `<article class="word-card" data-word="${escapeHtml(r.word)}">
        <div class="word-line">
          <span class="chips">${cells}</span>
          ${r.isException ? '<span class="badge">例外</span>' : ''}
          <span class="hyphenated">${escapeHtml(r.hyphenated || r.word)}</span>
        </div>
        <div class="gap-detail" hidden></div>
      </article>`;
    })
    .join('');
}

function chipHtml(word: string, g: GapInfo): string {
  const label = g.status === 'edge' ? '·' : String(g.finalScore);
  return (
    `<button class="chip ${chipClass(g.status)}" type="button" ` +
    `data-word="${escapeHtml(word)}" data-gap="${g.gap}" title="${escapeHtml(titleFor(g))}">${label}</button>`
  );
}

function showDetail(card: HTMLElement, result: WordResult, gapNo: number): void {
  const detail = card.querySelector('.gap-detail') as HTMLElement;
  detail.hidden = false;
  detail.innerHTML = `<table class="gap-table">
    <thead><tr>
      <th>间隙</th><th>左/右</th><th>模式分值</th><th>贡献最大值的模式</th>
      <th>最终分值</th><th>状态</th><th>原因</th>
    </tr></thead>
    <tbody>${result.gaps
      .map((g) => {
        const cls = g.gap === gapNo ? ' class="sel"' : '';
        return `<tr${cls}>
        <td>${g.gap}</td>
        <td>${g.left} / ${g.right}</td>
        <td>${g.patternScore}</td>
        <td class="mono">${g.patternSource ? escapeHtml(g.patternSource.raw) : '—'}</td>
        <td><b>${g.finalScore}</b></td>
        <td><span class="dot ${chipClass(g.status)}"></span>${statusText(g.status)}</td>
        <td class="reason">${escapeHtml(g.reason)}</td>
      </tr>`;
      })
      .join('')}</tbody></table>`;
}

outEl.addEventListener('click', (ev) => {
  const chip = (ev.target as HTMLElement).closest('.chip') as HTMLElement | null;
  if (!chip) return;
  const word = chip.dataset.word!;
  const gap = Number(chip.dataset.gap);
  const result = currentResults.find((r) => r.word === word);
  const card = outEl.querySelector(`.word-card[data-word="${CSS.escape(word)}"]`) as HTMLElement | null;
  if (result && card) showDetail(card, result, gap);
});

$('exportBtn').addEventListener('click', () => {
  const blob = new Blob([lastJSON], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'hyphen-dictionary.json';
  a.click();
  URL.revokeObjectURL(url);
});

let timer: ReturnType<typeof setTimeout> | undefined;
for (const el of [patternsEl, exceptionsEl, wordsEl, leftMinEl, rightMinEl]) {
  el.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(compute, 150);
  });
}

patternsEl.value = DEFAULT_PATTERNS;
exceptionsEl.value = DEFAULT_EXCEPTIONS;
wordsEl.value = DEFAULT_WORDS;
compute();
