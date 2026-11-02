import type { Comparison, Mark } from './compare';

export interface CopyFormat { fontFamily: string; fontSizePt: number; lineSpacing: number }
export interface TextPart { text: string; changed: boolean }
export const DEFAULT_COPY_FORMAT: CopyFormat = { fontFamily: 'Times New Roman', fontSizePt: 12, lineSpacing: 1.5 };
export const FORMAT_STORAGE_KEY = 'draftdiff.text-format.v1';

export function validCopyFormat(value: unknown): value is CopyFormat {
  if (!value || typeof value !== 'object') return false;
  const format = value as CopyFormat;
  return typeof format.fontFamily === 'string' && /^[\p{L}\p{N} _-]{1,80}$/u.test(format.fontFamily)
    && Number.isFinite(format.fontSizePt) && format.fontSizePt >= 8 && format.fontSizePt <= 72
    && Number.isFinite(format.lineSpacing) && format.lineSpacing >= 1 && format.lineSpacing <= 3;
}

export function loadCopyFormat(): CopyFormat {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FORMAT_STORAGE_KEY) ?? 'null');
    if (validCopyFormat(value)) return value;
  } catch { /* Storage can be unavailable; copying still works with defaults. */ }
  return { ...DEFAULT_COPY_FORMAT };
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const isLetter = (text: string) => /[\p{L}\p{N}]/u.test(text);

/** Zero-width deletions use a surviving character, without adding text. */
export function afterTextMarks(text: string, comparison: Comparison): Mark[] {
  const marks = [...comparison.after];
  const letters = Array.from(graphemes.segment(text)).filter(part => isLetter(part.segment));
  for (const change of comparison.changes) {
    if (!change.before || change.after) continue;
    const position = change.afterStart;
    let low = 0, high = letters.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (letters[middle].index < position) low = middle + 1;
      else high = middle;
    }
    const target = letters[low]?.index === position ? letters[low] : letters[low - 1] ?? letters[low];
    if (target) marks.push({ start: target.index, end: target.index + target.segment.length, change: change.id });
  }
  return marks.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Merge intersecting ranges once; preview and clipboard share these slices. */
export function textParts(text: string, marks: Mark[]): TextPart[] {
  const ranges: { start: number; end: number }[] = [];
  for (const mark of [...marks].sort((a, b) => a.start - b.start)) {
    const start = Math.max(0, mark.start), end = Math.min(text.length, mark.end);
    if (end <= start) continue;
    const last = ranges.at(-1);
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else ranges.push({ start, end });
  }
  const parts: TextPart[] = [];
  let offset = 0;
  for (const range of ranges) {
    if (offset < range.start) parts.push({ text: text.slice(offset, range.start), changed: false });
    parts.push({ text: text.slice(range.start, range.end), changed: true });
    offset = range.end;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset), changed: false });
  return parts;
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function highlightedHtml(parts: TextPart[], format: CopyFormat): string {
  if (!validCopyFormat(format)) throw new Error('Choose a font name, a size from 8–72 pt, and line spacing from 1–3.');
  const font = `font-family:'${escapeHtml(format.fontFamily)}';font-size:${format.fontSizePt}pt`;
  const content = parts.map(part => {
    // Preserve spaces and tabs as their original code points. Word's HTML
    // importer understands mso-spacerun and mso-tab-count; no NBSP substitution.
    const escaped = escapeHtml(part.text).replace(/ +/g, value => `<span style="mso-spacerun:yes">${value}</span>`)
      .replace(/\t/g, '<span style="mso-tab-count:1">\t</span>').replace(/\r\n|\r|\n/g, '<br>');
    return part.changed ? `<span style="color:#ff0000">${escaped}</span>` : escaped;
  }).join('');
  // Word collapses spaces in a normal paragraph, even with white-space and
  // mso-spacerun. A PRE context preserves actual U+0020 characters; the inner
  // paragraph supplies Word's font and proportional line-spacing properties.
  return `<html><head><meta charset="utf-8"></head><body><!--StartFragment--><pre style="margin:0;white-space:pre-wrap"><p style="margin:0;${font};line-height:${format.lineSpacing * 100}%;mso-line-height-rule:auto;white-space:pre-wrap"><span style="${font}">${content}</span></p></pre><!--EndFragment--></body></html>`;
}

export async function copyHighlightedText(text: string, parts: TextPart[], format: CopyFormat): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('Formatted copying is unavailable. Open DraftDiff in Chrome using HTTPS or localhost.');
  }
  await navigator.clipboard.write([new ClipboardItem({
    'text/html': new Blob([highlightedHtml(parts, format)], { type: 'text/html' }),
    'text/plain': new Blob([text], { type: 'text/plain' }),
  })]);
}
