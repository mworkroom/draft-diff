export const OPENING_COMMENT_END = '단락 앞 숫자는 기존 단락 순서입니다.';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const whitespace = /[\s\u200b\ufeff]/u;
const compact = (text: string) => text.replace(/[\s\u200b\ufeff]/gu, '');
const propertyNames = new Set(['pPr', 'rPr', 'tblPr', 'tblGrid', 'trPr', 'tcPr', 'sdtPr', 'sdtEndPr']);

export interface OpeningCommentResult { xml: string; removed: boolean }

/** Cut the in-memory DOCX body, retaining run/paragraph properties after the
 * marker. Whitespace and Word run boundaries do not affect marker matching.
 * The first matching sentence is inclusive; later text is never inferred away.
 */
export function excludeOpeningComments(source: string): OpeningCommentResult {
  const xml = new DOMParser().parseFromString(source, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('The Word document XML is damaged.');
  const body = xml.getElementsByTagNameNS(WORD_NS, 'body')[0];
  if (!body) throw new Error('Could not find the Word document body.');

  const pieces: { node: Text; start: number; end: number }[] = [];
  const normalized: string[] = [];
  let position = 0;
  for (const run of body.getElementsByTagNameNS(WORD_NS, 't')) {
    for (const child of run.childNodes) {
      if (child.nodeType !== Node.TEXT_NODE && child.nodeType !== Node.CDATA_SECTION_NODE) continue;
      const value = compact(child.textContent ?? '');
      if (!value) continue;
      pieces.push({ node: child as Text, start: position, end: position + value.length });
      normalized.push(value); position += value.length;
    }
  }
  const marker = compact(OPENING_COMMENT_END);
  const start = normalized.join('').indexOf(marker);
  if (start < 0) return { xml: source, removed: false };
  const end = start + marker.length;
  const piece = pieces.find(piece => piece.start < end && piece.end >= end)!;
  let count = 0, offset = 0;
  while (offset < piece.node.data.length && count < end - piece.start) {
    if (!whitespace.test(piece.node.data[offset])) count++;
    offset++;
  }

  // Word properties are child elements, rather than HTML-style attributes.
  // Range.deleteContents would remove them from partially retained ancestors.
  const retained: { element: Element; properties: Element[] }[] = [];
  for (let element = piece.node.parentElement; element && element !== body; element = element.parentElement) {
    retained.push({ element, properties: [...element.children]
      .filter(child => child.namespaceURI === WORD_NS && propertyNames.has(child.localName))
      .map(child => child.cloneNode(true) as Element) });
  }
  const range = xml.createRange();
  range.setStart(body, 0); range.setEnd(piece.node, offset); range.deleteContents();
  for (const { element, properties } of retained) {
    if (!body.contains(element)) continue;
    for (const property of [...properties].reverse()) {
      if (![...element.children].some(child => child.namespaceURI === WORD_NS && child.localName === property.localName)) {
        element.insertBefore(property, element.firstChild);
      }
    }
  }

  const hasContent = (element: Element) => [...element.getElementsByTagNameNS(WORD_NS, 't')].some(t => t.textContent?.trim())
    || ['drawing', 'pict', 'object'].some(name => element.getElementsByTagNameNS(WORD_NS, name).length > 0);
  while (body.firstElementChild && body.firstElementChild.localName !== 'sectPr' && !hasContent(body.firstElementChild)) {
    body.firstElementChild.remove();
  }

  // The retained body now starts on its own first page. Discard only leading
  // old pagination hints/breaks; retain all later pagination and body styling.
  const firstParagraph = body.getElementsByTagNameNS(WORD_NS, 'p')[0];
  firstParagraph?.getElementsByTagNameNS(WORD_NS, 'pPr')[0]
    ?.getElementsByTagNameNS(WORD_NS, 'pageBreakBefore')[0]?.remove();
  function removeLeadingBreaks(element: Element): boolean {
    if (element.namespaceURI === WORD_NS && propertyNames.has(element.localName)) return false;
    if (element.namespaceURI === WORD_NS && ['br', 'lastRenderedPageBreak'].includes(element.localName)) {
      element.remove(); return false;
    }
    if (element.namespaceURI === WORD_NS && element.localName === 't') return Boolean(element.textContent?.trim());
    if (element.namespaceURI === WORD_NS && ['drawing', 'pict', 'object'].includes(element.localName)) return true;
    for (const child of [...element.children]) if (removeLeadingBreaks(child)) return true;
    return false;
  }
  removeLeadingBreaks(body);
  return { xml: new XMLSerializer().serializeToString(xml), removed: true };
}
