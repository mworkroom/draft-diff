import { useEffect, useRef, useState } from 'react';
import { FilePicker } from './components/FilePicker';
import { DocumentPane } from './components/DocumentPane';
import { applyMarks, renderDocument, validateFile, type RenderedDocument } from './lib/document';
import type { Comparison, Side } from './lib/compare';
import { OPENING_COMMENT_END } from './lib/opening-comments';

function Arrow({ next = false }: { next?: boolean }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={next ? 'M5 12h14m-6-6 6 6-6 6' : 'M19 12H5m6-6-6 6 6 6'} /></svg>;
}

export function App() {
  const [files, setFiles] = useState<{ before: File | null; after: File | null }>({ before: null, after: null });
  const [docs, setDocs] = useState<{ before: RenderedDocument | null; after: RenderedDocument | null }>({ before: null, after: null });
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [showMarks, setShowMarks] = useState(true);
  const [ignoreOpeningComments, setIgnoreOpeningComments] = useState(true);
  const [syncScroll, setSyncScroll] = useState(true);
  const [zoom, setZoom] = useState('100');
  const [current, setCurrent] = useState(-1);
  const beforeHost = useRef<HTMLDivElement>(null), afterHost = useRef<HTMLDivElement>(null);
  const beforeScroll = useRef<HTMLDivElement>(null), afterScroll = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const scrollLock = useRef(false);
  const scrollFrame = useRef(0);
  const running = useRef(false);
  const hasCompared = useRef(false);

  useEffect(() => () => { workerRef.current?.terminate(); cancelAnimationFrame(scrollFrame.current); }, []);
  useEffect(() => {
    for (const doc of [docs.before, docs.after]) if (doc) doc.host.dataset.marks = showMarks ? 'on' : 'off';
  }, [docs, showMarks]);

  function pick(side: Side, file: File) {
    try {
      validateFile(file);
      setFiles(previous => ({ ...previous, [side]: file }));
      setDocs({ before: null, after: null }); setComparison(null); setCurrent(-1);
      hasCompared.current = false;
      setError(''); setStatus('File selected. Choose both documents, then click Compare.');
      for (const host of [beforeHost.current, afterHost.current]) host?.shadowRoot?.replaceChildren();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not select the file.'); }
  }

  async function compare(selected = files, skipComments = ignoreOpeningComments) {
    if (!selected.before || !selected.after || running.current) return;
    running.current = true; hasCompared.current = true; setBusy(true); setError(''); setCurrent(-1);
    setComparison(null); setDocs({ before: null, after: null });
    setStatus('Reading documents…');
    try {
      const [beforeResult, afterResult] = await Promise.allSettled([
        renderDocument(selected.before, beforeHost.current!, 'before', { ignoreOpeningComments: skipComments }),
        renderDocument(selected.after, afterHost.current!, 'after'),
      ]);
      // Finish both renders before exposing a retry/toggle after an error.
      if (beforeResult.status === 'rejected') throw beforeResult.reason;
      if (afterResult.status === 'rejected') throw afterResult.reason;
      const before = beforeResult.value, after = afterResult.value;
      setStatus('Finding changes…');
      const result = await new Promise<Comparison>((resolve, reject) => {
        const worker = new Worker(new URL('./lib/compare.worker.ts', import.meta.url), { type: 'module' });
        workerRef.current = worker;
        const timer = setTimeout(() => { worker.terminate(); reject(new Error('Comparison timed out. Try comparing smaller sections of the documents.')); }, 20000);
        const done = () => { clearTimeout(timer); worker.terminate(); workerRef.current = null; };
        worker.onmessage = event => { done(); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result); };
        worker.onerror = () => { done(); reject(new Error('Could not start the comparison engine. Refresh the page and try again.')); };
        worker.postMessage({ before: before.blocks, after: after.blocks });
      });
      applyMarks(before, result.before); applyMarks(after, result.after);
      setDocs({ before, after }); setComparison(result);
      setStatus(result.changes.length ? `Comparison complete · ${result.changes.length} changes` : 'Comparison complete · No text changes found.');
      requestAnimationFrame(() => {
        beforeScroll.current?.scrollTo(0, 0); afterScroll.current?.scrollTo(0, 0);
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not compare the documents.');
      setStatus('');
    } finally { running.current = false; setBusy(false); }
  }

  function toggleOpeningComments(enabled: boolean) {
    setIgnoreOpeningComments(enabled);
    if (hasCompared.current && files.before && files.after) void compare(files, enabled);
  }

  async function demo() {
    if (running.current) return;
    setBusy(true); setError(''); setStatus('Loading example documents…');
    try {
      const sampleFiles = await Promise.all(['before', 'after'].map(async side => {
        const response = await fetch(`${import.meta.env.BASE_URL}samples/${side}.docx`);
        if (!response.ok) throw new Error('Could not load the example files.');
        return new File([await response.blob()], `${side}.docx`);
      }));
      const selected = { before: sampleFiles[0], after: sampleFiles[1] };
      setFiles(selected);
      await compare(selected);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the example.'); setBusy(false); setStatus('');
    }
  }

  function scroll(side: Side) {
    if (!syncScroll || scrollLock.current || !comparison) return;
    const source = side === 'before' ? beforeScroll.current : afterScroll.current;
    const target = side === 'before' ? afterScroll.current : beforeScroll.current;
    if (!source || !target) return;
    scrollLock.current = true;
    // Proportional scroll only; no semantic move detection or page matching.
    const total = source.scrollHeight - source.clientHeight;
    target.scrollTop = total > 0 ? source.scrollTop / total * (target.scrollHeight - target.clientHeight) : 0;
    cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(() => { scrollLock.current = false; });
  }

  function navigate(direction: number) {
    if (!comparison?.changes.length) return;
    const count = comparison.changes.length;
    const index = current < 0 ? (direction > 0 ? 0 : count - 1) : (current + direction + count) % count;
    setCurrent(index); setShowMarks(true);
    scrollLock.current = true;
    for (const [side, viewport] of [['before', beforeScroll.current], ['after', afterScroll.current]] as const) {
      const doc = docs[side];
      if (!doc || !viewport) continue;
      doc.root.querySelectorAll('[data-current]').forEach(el => el.removeAttribute('data-current'));
      const marks = doc.root.querySelectorAll<HTMLElement>(`[data-diff="${index}"]`);
      marks.forEach(el => el.dataset.current = '');
      const mark = marks[0];
      if (mark) {
        const rect = mark.getBoundingClientRect(), frame = viewport.getBoundingClientRect();
        viewport.scrollTop += rect.top - frame.top - viewport.clientHeight * .3;
        if (rect.left < frame.left || rect.right > frame.right) viewport.scrollLeft += rect.left - frame.left - 32;
      }
    }
    cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(() => { scrollLock.current = false; });
  }

  const warnings = [...new Set([...(docs.before?.warnings ?? []), ...(docs.after?.warnings ?? [])])];
  return <div className="app-shell">
    <header className="app-header">
      <div className="brand"><svg viewBox="0 0 40 40" aria-hidden="true"><rect x="15" y="12" width="19" height="24" rx="3" /><rect x="5" y="4" width="19" height="25" rx="3" /><path d="M10 11h9M10 16h7M28 20h2M28 25h2M28 30h2" /></svg><h1>DraftDiff</h1></div>
      <p className="tagline">Original formatting. Changes side by side.</p>
      <p className="privacy">Files stay in this browser.</p>
    </header>
    <main>
      <div className="file-pickers">
        <FilePicker side="before" file={files.before} disabled={busy} onFile={file => pick('before', file)} />
        <FilePicker side="after" file={files.after} disabled={busy} onFile={file => pick('after', file)} />
      </div>
      <div className="comparison-settings">
        <label className="check"><input type="checkbox" checked={ignoreOpeningComments} disabled={busy}
          onChange={event => toggleOpeningComments(event.target.checked)} />Skip opening comments in Before</label>
        <span className="settings-help">Skip everything through: <span lang="ko">“{OPENING_COMMENT_END}”</span></span>
      </div>
      <div className="toolbar" aria-label="Comparison tools">
        <div className="toolbar-actions">
          <button className="button primary" disabled={busy || !files.before || !files.after} onClick={() => compare()}>{busy ? <><span className="spinner" />Comparing…</> : 'Compare'}</button>
          <button className="button" disabled={busy} onClick={demo}>Try example</button>
        </div>
        <div className="toolbar-options">
          <label className="check"><input type="checkbox" checked={showMarks} onChange={event => setShowMarks(event.target.checked)} />Show changes</label>
          <label className="check"><input type="checkbox" checked={syncScroll} onChange={event => setSyncScroll(event.target.checked)} />Sync scrolling</label>
          <label className="zoom-label">Zoom<select value={zoom} onChange={event => setZoom(event.target.value)} aria-label="Document zoom">
            <option value="fit">Fit width</option>{[75, 90, 100, 110, 125, 150, 175, 200].map(value => <option value={value} key={value}>{value}%</option>)}
          </select></label>
        </div>
        <div className="toolbar-results" aria-live="polite">
          <span className="count"><span className="dot before" />Removed {comparison?.before.length ?? 0}</span>
          <span className="count"><span className="dot after" />Added {comparison?.after.length ?? 0}</span>
          <span className="position">{comparison?.changes.length ? `${current < 0 ? '—' : current + 1} / ${comparison.changes.length}` : '— / —'}</span>
          <button className="button navigation" disabled={busy || !comparison?.changes.length} onClick={() => navigate(-1)} aria-label="Previous change"><Arrow />Previous</button>
          <button className="button navigation" disabled={busy || !comparison?.changes.length} onClick={() => navigate(1)} aria-label="Next change">Next<Arrow next /></button>
        </div>
      </div>
      {(status || error || warnings.length > 0) && <div className={`status-strip ${error ? 'has-error' : ''}`} role={error ? 'alert' : 'status'}>
        <span>{error || status}</span>{!error && warnings.map(warning => <span key={warning}>{warning}</span>)}
      </div>}
      <div className="documents" aria-busy={busy}>
        <DocumentPane side="before" doc={docs.before} zoom={zoom} busy={busy} hostRef={beforeHost} scrollRef={beforeScroll} onScroll={scroll} />
        <DocumentPane side="after" doc={docs.after} zoom={zoom} busy={busy} hostRef={afterHost} scrollRef={afterScroll} onScroll={scroll} />
      </div>
    </main>
    <footer>Supports .docx · Files are never uploaded or saved.<span>Compares body and table text. Headers, footers and notes are display only.</span></footer>
  </div>;
}
