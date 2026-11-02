import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { RenderedDocument } from '../lib/document';
import type { Side } from '../lib/compare';

interface Props {
  side: Side; doc: RenderedDocument | null; zoom: string; busy: boolean;
  hostRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: (side: Side) => void;
}
export function DocumentPane({ side, doc, zoom, busy, hostRef, scrollRef, onScroll }: Props) {
  const [availableWidth, setAvailableWidth] = useState(800);
  const stageRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(entries => setAvailableWidth(entries[0].contentRect.width - 48));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [scrollRef]);
  const scale = doc ? (zoom === 'fit' ? Math.max(.25, Math.min(1.5, availableWidth / doc.width)) : Number(zoom) / 100) : 1;
  return <section className={`document-pane ${side}`} aria-label={side === 'before' ? 'Before document' : 'After document'}>
    <div className="scroll-area" ref={scrollRef} onScroll={() => onScroll(side)} tabIndex={0}>
      <div className="paper-stage" ref={stageRef} style={{
        width: doc ? doc.width * scale : undefined,
        height: doc ? doc.height * scale : undefined,
        visibility: doc ? 'visible' : 'hidden',
      }}>
        <div ref={hostRef} className="document-host" style={{ transform: `scale(${scale})` }} />
      </div>
      {!doc && <div className="empty-document">
        <svg viewBox="0 0 48 56" fill="none" aria-hidden="true"><path d="M8 3h22l10 10v40H8zM30 3v12h10M16 25h16M16 33h16M16 41h10" /></svg>
        <h2>{busy ? 'Preparing document' : side === 'before' ? 'Original document' : 'Revised document'}</h2>
        <p>{busy ? 'Reading the file and preserving its formatting.' : 'Choose a Word document above.'}</p>
        {!busy && <p className="empty-hint">Try the example to see how comparison works.</p>}
      </div>}
    </div>
  </section>;
}
