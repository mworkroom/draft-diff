import { diffArrays } from 'diff';

export type Side = 'before' | 'after';
export interface Mark { start: number; end: number; change: number }
export interface Change { id: number; before?: Mark; after?: Mark; beforeStart: number; afterStart: number; preview: string }
export interface Comparison { before: Mark[]; after: Mark[]; changes: Change[] }

const segmenter = new Intl.Segmenter('ko', { granularity: 'word' });
const tokens = (text: string) => Array.from(segmenter.segment(text), part => part.segment);
const limits = { timeout: 3500, maxEditLength: 12000 };

/** Paragraph alignment first, word-level detail only inside changed regions.
 * No move detection: a moved passage is a deletion and an insertion.
 * Offsets refer to the unchanged, rendered document text (UTF-16).
 */
export function compareBlocks(beforeBlocks: string[], afterBlocks: string[]): Comparison {
  const result: Comparison = { before: [], after: [], changes: [] };
  if (beforeBlocks.join('').length + afterBlocks.join('').length > 1_500_000) {
    throw new Error('The documents contain too much text. Try comparing smaller sections.');
  }
  if (beforeBlocks.length === afterBlocks.length && beforeBlocks.every((block, index) => block === afterBlocks[index])) {
    return result;
  }
  // Empty paragraphs repeat throughout Word files. Matching them as anchors can
  // pair a title's blank line with a section's blank line and split shared text
  // into unrelated deletion-only / insertion-only regions. Only real text may
  // anchor paragraphs; whitespace still participates in each word-level diff.
  const coarse = diffArrays(beforeBlocks, afterBlocks, {
    ...limits,
    comparator: (before, after) => before.trim().length > 0 && before === after,
  });
  if (!coarse) throw new Error('Too many changes to compare within the time limit. Try smaller sections.');
  let oldOffset = 0, newOffset = 0;
  let removed = '', added = '';
  function flush() {
    if (!removed && !added) return;
    const fine = diffArrays(tokens(removed), tokens(added), limits);
    if (!fine) throw new Error('Too many changes to compare within the time limit. Try smaller sections.');
    let pending: Change | undefined;
    for (const part of fine) {
      const value = part.value.join('');
      if (!part.added && !part.removed) {
        pending = undefined;
        oldOffset += value.length;
        newOffset += value.length;
        continue;
      }
      if (!pending) {
        pending = { id: result.changes.length, beforeStart: oldOffset, afterStart: newOffset, preview: '' };
        result.changes.push(pending);
      }
      pending.preview += value;
      const side = part.removed ? 'before' : 'after';
      const start = part.removed ? oldOffset : newOffset;
      const mark = { start, end: start + value.length, change: pending.id };
      result[side].push(mark);
      pending[side] = mark;
      if (part.removed) oldOffset += value.length;
      else newOffset += value.length;
    }
    removed = ''; added = '';
  }
  for (const part of coarse) {
    const value = part.value.join('');
    if (part.removed) removed += value;
    else if (part.added) added += value;
    else {
      flush();
      oldOffset += value.length;
      newOffset += value.length;
    }
  }
  flush();
  return result;
}
