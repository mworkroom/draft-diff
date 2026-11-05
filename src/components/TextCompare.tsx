import { useEffect, useMemo, useRef, useState } from 'react';
import type { Comparison, Side } from '../lib/compare';
import { afterTextMarks, copyHighlightedText, FORMAT_STORAGE_KEY, loadCopyFormat, textParts, validCopyFormat, type CopyFormat } from '../lib/text-compare';

const EMPTY = { before: '', after: '' };

export function TextCompare() {
  const [input, setInput] = useState(EMPTY);
  const [result, setResult] = useState<Comparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState(false);
  const [status, setStatus] = useState('Paste both texts, then compare. One side can be empty.');
  const [error, setError] = useState('');
  const [format, setFormat] = useState<CopyFormat>(loadCopyFormat);
  const beforeInput = useRef<HTMLTextAreaElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const revision = useRef(0);

  useEffect(() => () => workerRef.current?.terminate(), []);
  useEffect(() => {
    if (validCopyFormat(format)) {
      try { localStorage.setItem(FORMAT_STORAGE_KEY, JSON.stringify(format)); } catch { /* Optional preference storage. */ }
    }
  }, [format]);

  const parts = useMemo(() => ({
    before: result ? textParts(input.before, result.before) : [],
    after: result ? textParts(input.after, afterTextMarks(input.after, result)) : [],
  }), [input, result]);

  function edit(side: Side, value: string) {
    revision.current++;
    setInput(previous => ({ ...previous, [side]: value }));
    setResult(null); setError(''); setStatus('Text changed. Click Compare to update the results.');
  }

  function clear() {
    revision.current++;
    setInput(EMPTY); setResult(null); setError(''); setStatus('Cleared. Ready for the next paragraph.');
    beforeInput.current?.focus();
  }

  async function compare() {
    if (busy || (!input.before && !input.after)) return;
    setBusy(true); setError(''); setResult(null); setStatus('Finding changes…');
    revision.current++;
    try {
      const comparison = await new Promise<Comparison>((resolve, reject) => {
        const worker = new Worker(new URL('../lib/compare.worker.ts', import.meta.url), { type: 'module' });
        workerRef.current = worker;
        const done = () => { clearTimeout(timer); worker.terminate(); workerRef.current = null; };
        const timer = setTimeout(() => { done(); reject(new Error('Comparison timed out. Try a smaller section.')); }, 20000);
        worker.onmessage = event => { done(); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result); };
        worker.onerror = () => { done(); reject(new Error('Could not start comparison. Refresh and try again.')); };
        worker.postMessage({ before: [input.before], after: [input.after] });
      });
      setResult(comparison);
      setStatus(comparison.changes.length ? `Comparison complete · ${comparison.changes.length} changes` : 'No text changes found. Both results can be copied.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not compare the text.'); setStatus('');
    } finally { setBusy(false); }
  }

  async function copy(side: Side) {
    if (!result || copying) return;
    const atRevision = revision.current;
    setCopying(true); setError('');
    try {
      await copyHighlightedText(input[side], parts[side], format);
      if (atRevision === revision.current) setStatus(`${side === 'before' ? 'Before' : 'After'} copied with formatting. In Word, choose Keep Source Formatting.`);
    } catch {
      if (atRevision === revision.current) setError('Could not copy formatted text. Allow clipboard access in Chrome and try again.');
    } finally { setCopying(false); }
  }

  return <section className="text-compare" aria-label="Text comparison">
    <div className="text-toolbar">
      <button className="button primary" disabled={busy || copying || (!input.before && !input.after)} onClick={compare}>{busy ? 'Comparing…' : 'Compare'}</button>
      <button className="button" disabled={busy || copying} onClick={clear}>Clear</button>
      <span>Red text marks changes. In After, one red letter also marks a deletion point.</span>
    </div>
    <fieldset className="copy-format" disabled={copying}>
      <legend>Word copy format</legend>
      <label>Font<input type="text" value={format.fontFamily} maxLength={80} onChange={event => setFormat(previous => ({ ...previous, fontFamily: event.target.value }))} /></label>
      <label>Size (pt)<input type="number" min="8" max="72" step="0.5" value={Number.isNaN(format.fontSizePt) ? '' : format.fontSizePt} onChange={event => setFormat(previous => ({ ...previous, fontSizePt: event.target.valueAsNumber }))} /></label>
      <label>Line spacing<input type="number" min="1" max="3" step="0.05" value={Number.isNaN(format.lineSpacing) ? '' : format.lineSpacing} onChange={event => setFormat(previous => ({ ...previous, lineSpacing: event.target.valueAsNumber }))} /></label>
      <label>First-line indent (cm)<input type="number" min="0" max="10" step="0.01" value={Number.isNaN(format.firstLineIndentCm) ? '' : format.firstLineIndentCm} onChange={event => setFormat(previous => ({ ...previous, firstLineIndentCm: event.target.valueAsNumber }))} /></label>
      <label>Space after paragraph (pt)<input type="number" min="0" max="72" step="0.5" value={Number.isNaN(format.paragraphAfterPt) ? '' : format.paragraphAfterPt} onChange={event => setFormat(previous => ({ ...previous, paragraphAfterPt: event.target.valueAsNumber }))} /></label>
      <span>Proofing: English (US). In Word, use <strong>Keep Source Formatting</strong> to retain this format and red text.</span>
    </fieldset>
    {!validCopyFormat(format) && <p className="text-error" role="alert">Use a font name with letters, numbers, spaces or hyphens; size 8–72 pt; line spacing 1–3; indent 0–10 cm; paragraph spacing 0–72 pt.</p>}
    <p className={`text-status ${error ? 'text-error' : ''}`} role={error ? 'alert' : 'status'}>{error || status}</p>
    <div className="text-columns" aria-busy={busy}>
      {(['before', 'after'] as const).map(side => {
        const title = side === 'before' ? 'Before' : 'After';
        return <section className="text-column" key={side} aria-label={`${title} text`}>
          <label className="text-input-label" htmlFor={`text-${side}`}><strong>{title}</strong><span>{side === 'before' ? 'Original text' : 'Revised text'}</span></label>
          <textarea id={`text-${side}`} ref={side === 'before' ? beforeInput : undefined} value={input[side]} disabled={busy || copying}
            spellCheck={false} placeholder={`Paste ${side === 'before' ? 'original' : 'revised'} text here…`} onChange={event => edit(side, event.target.value)} />
          <div className="text-result-heading"><h2>{title} result</h2><button className="button" disabled={!result || busy || copying || !input[side] || !validCopyFormat(format)} onClick={() => copy(side)}>Copy {title}</button></div>
          <div className="text-result" tabIndex={0} role="region" aria-label={`${title} comparison result`}
            style={result && validCopyFormat(format) ? { textIndent: `${format.firstLineIndentCm}cm` } : undefined}>
            {result ? (input[side] ? parts[side].map((part, index) => part.changed ? <span className="changed-text" key={index}>{part.text}</span> : part.text) : <span className="result-hint">This side is empty.</span>)
              : <span className="result-hint">Compare to preview the text that will be copied.</span>}
          </div>
        </section>;
      })}
    </div>
    <p className="text-help">Plain-text input · Copy uses the format above · Text is not uploaded or saved.</p>
  </section>;
}
