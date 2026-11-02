import JSZip from 'jszip';
import { renderAsync } from 'docx-preview';
import type { Mark, Side } from './compare';

const MAX_SIZE = 20 * 1024 * 1024;
const MAX_UNPACKED = 100 * 1024 * 1024;
interface Piece { node: Text; start: number; end: number }
interface Block { element: HTMLElement; start: number; end: number }
export interface RenderedDocument {
  root: ShadowRoot;
  host: HTMLElement;
  content: HTMLElement;
  blocks: string[];
  pieces: Piece[];
  paragraphs: Block[];
  width: number;
  height: number;
  warnings: string[];
}

export function validateFile(file: File) {
  if (!/\.docx$/i.test(file.name)) throw new Error('Choose a .docx file. For older .doc files, save a .docx copy in Word first.');
  if (file.size > MAX_SIZE) throw new Error('Each file must be 20 MB or smaller.');
  if (!file.size) throw new Error('The file is empty. Choose another file.');
}

/** Validate ZIP directory sizes before decompression (also rejects encrypted ZIPs). */
function validateArchive(buffer: ArrayBuffer) {
  const data = new DataView(buffer);
  let eocd = -1;
  for (let i = data.byteLength - 22; i >= Math.max(0, data.byteLength - 65557); i--) {
    if (data.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This is not a valid .docx file.');
  const count = data.getUint16(eocd + 10, true);
  let cursor = data.getUint32(eocd + 16, true), total = 0;
  if (count === 0xffff || count > 8000) throw new Error('The document structure is too complex.');
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > data.byteLength || data.getUint32(cursor, true) !== 0x02014b50) throw new Error('The .docx file is damaged.');
    if (data.getUint16(cursor + 8, true) & 1) throw new Error('Encrypted files are not supported. Remove the password in Word first.');
    total += data.getUint32(cursor + 24, true);
    if (total > MAX_UNPACKED) throw new Error('The unpacked document is too large. Reduce image sizes or split the document.');
    cursor += 46 + data.getUint16(cursor + 28, true) + data.getUint16(cursor + 30, true) + data.getUint16(cursor + 32, true);
  }
}

async function prepareFile(file: File) {
  validateFile(file);
  const buffer = await file.arrayBuffer();
  validateArchive(buffer);
  const zip = await JSZip.loadAsync(buffer);
  if (!zip.file('word/document.xml')) throw new Error('Could not find the Word document content.');
  const warnings: string[] = [];
  let externalCount = 0;
  await Promise.all(Object.keys(zip.files).filter(path => path.endsWith('.rels')).map(async path => {
    const text = await zip.file(path)!.async('string');
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('The document relationship data is damaged.');
    for (const rel of Array.from(xml.getElementsByTagNameNS('*', 'Relationship'))) {
      if (rel.getAttribute('TargetMode')?.toLowerCase() === 'external') { rel.remove(); externalCount++; }
    }
    zip.file(path, new XMLSerializer().serializeToString(xml));
  }));
  const xml = await zip.file('word/document.xml')!.async('string');
  if (/<w:(ins|del|moveFrom|moveTo)[\s>]/.test(xml)) {
    throw new Error('This document contains tracked changes. Accept or reject them in Word, save a separate .docx copy, then compare again.');
  }
  if (externalCount) warnings.push('External links and images are not loaded. Only embedded content is displayed.');
  if (/<w:(altChunk|txbxContent|object)[\s>]/.test(xml)) warnings.push('Some embedded objects and text boxes may not display or compare fully.');
  return { blob: await zip.generateAsync({ type: 'blob' }), warnings };
}

const markStyles = `
:host { display:block; color:#111; }
.document-content { display:flow-root; }
.document-content > section.docx { margin:0 auto 24px; background:#fff; box-shadow:0 2px 12px #14253d18; }
[data-diff] { background-color:rgba(238,84,100,.25); box-shadow:inset 0 -1.5px rgba(191,40,60,.6); -webkit-box-decoration-break:clone; box-decoration-break:clone; }
:host([data-side="after"]) [data-diff] { background-color:rgba(71,142,244,.24); box-shadow:inset 0 -1.5px rgba(35,105,211,.6); }
[data-boundary] { position:absolute; display:inline-block; width:3px; height:1em; margin-left:2px; box-shadow:none; border-radius:1px; }
:host([data-marks="off"]) [data-diff] { background-color:transparent; box-shadow:none; }
[data-current] { outline:2px solid #ec8190; outline-offset:2px; }
:host([data-side="after"]) [data-current] { outline-color:#6a9ce1; }
:host([data-marks="off"]) [data-current] { outline:none; }
a { cursor:text; }
`;

export async function renderDocument(file: File, host: HTMLElement, side: Side): Promise<RenderedDocument> {
  const { blob, warnings } = await prepareFile(file);
  host.dataset.side = side;
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  root.replaceChildren();
  host.style.width = '794px';
  const style = document.createElement('style');
  const documentStyles = document.createElement('div');
  const content = document.createElement('div');
  content.className = 'document-content';
  root.append(documentStyles, content);
  await renderAsync(blob, content, documentStyles, {
    inWrapper: false, breakPages: true, ignoreLastRenderedPageBreak: false,
    renderHeaders: true, renderFooters: true, renderFootnotes: true,
    renderEndnotes: true, renderComments: false, renderChanges: false,
    renderAltChunks: false, useBase64URL: true, experimental: false,
  });
  // docx-preview emits theme variables on :root. Inside an isolated ShadowRoot,
  // those variables must be on :host so theme fonts work as in the document.
  documentStyles.querySelectorAll('style').forEach(element => {
    element.textContent = element.textContent?.replace(/:root\b/g, ':host') ?? '';
  });
  // The extra stylesheet comes last, keeping Word's original run styles intact.
  style.textContent = markStyles;
  root.append(style);
  content.querySelectorAll('a').forEach(anchor => { anchor.removeAttribute('href'); anchor.removeAttribute('target'); });
  const pieces: Piece[] = [], paragraphs: Block[] = [], blocks: string[] = [];
  let offset = 0;
  // Scope to body articles. Headers/footers/notes are visible, but not compared
  // because their automatic repetition and page numbers create false changes.
  for (const element of content.querySelectorAll<HTMLElement>('article p')) {
    const start = offset;
    let value = '';
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) return (node as Element).tagName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        if (node.parentElement?.closest('style, script, svg')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? '';
        pieces.push({ node: node as Text, start: offset, end: offset + text.length });
        value += text; offset += text.length;
      } else { value += '\n'; offset++; }
    }
    value += '\n'; offset++;
    blocks.push(value);
    paragraphs.push({ element, start, end: offset });
  }
  if (!blocks.join('').trim()) throw new Error('No body text was found to compare. Image-only documents are not supported.');
  await document.fonts.ready;
  const pages = [...content.querySelectorAll<HTMLElement>('section.docx')];
  const width = Math.max(794, ...pages.map(page => page.offsetWidth));
  const height = content.scrollHeight;
  host.style.width = `${width}px`;
  return { root, host, content, pieces, paragraphs, blocks, width, height, warnings };
}

export function applyMarks(doc: RenderedDocument, marks: Mark[]) {
  let cursor = 0;
  for (const piece of doc.pieces) {
    while (cursor < marks.length && marks[cursor].end <= piece.start) cursor++;
    let at = cursor, localOffset = 0;
    const fragment = document.createDocumentFragment();
    let touched = false;
    while (at < marks.length && marks[at].start < piece.end) {
      const mark = marks[at];
      const start = Math.max(mark.start, piece.start) - piece.start;
      const end = Math.min(mark.end, piece.end) - piece.start;
      if (end > start) {
        fragment.append(document.createTextNode(piece.node.data.slice(localOffset, start)));
        const span = document.createElement('span');
        span.dataset.diff = String(mark.change);
        span.textContent = piece.node.data.slice(start, end);
        fragment.append(span);
        localOffset = end; touched = true;
      }
      at++;
    }
    if (touched) {
      fragment.append(document.createTextNode(piece.node.data.slice(localOffset)));
      piece.node.replaceWith(fragment);
    }
  }
  for (const mark of marks) {
    if (!doc.root.querySelector(`[data-diff="${mark.change}"]`)) {
      const block = doc.paragraphs.find(block => block.start < mark.end && block.end > mark.start);
      if (block) {
        // A synthetic paragraph separator has no Text node to wrap. Give it a
        // small, out-of-flow marker instead of painting the whole paragraph.
        const marker = document.createElement('span');
        marker.dataset.diff = String(mark.change);
        marker.dataset.boundary = '';
        marker.setAttribute('role', 'img');
        marker.setAttribute('aria-label', 'Paragraph break changed');
        marker.title = 'Paragraph break changed';
        block.element.append(marker);
      }
    }
  }
}
