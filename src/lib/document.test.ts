// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { renderDocument, applyMarks, validateFile } from './document';
import { compareBlocks } from './compare';
import { OPENING_COMMENT_END } from './opening-comments';

// DOM emulator has no font loader or layout engine; actual font/color rendering
// is checked separately in Chrome. These tests cover document data and DOM.
Object.defineProperty(document, 'fonts', { value: { ready: Promise.resolve() }, configurable: true });
Object.defineProperty(File.prototype, 'arrayBuffer', { value: function () {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(this);
  });
} });

async function sample(side: string) {
  const buffer = await readFile(resolve('public', 'samples', `${side}.docx`));
  return new File([new Uint8Array(buffer)], `${side}.docx`);
}
function host() { const element = document.createElement('div'); document.body.append(element); return element; }

describe('실제 DOCX 파일 처리', () => {
  it('원래 색·형광펜·표·글을 유지한 채 정확한 변경 범위에만 표시한다', async () => {
    const [before, after] = await Promise.all([
      renderDocument(await sample('before'), host(), 'before'),
      renderDocument(await sample('after'), host(), 'after'),
    ]);
    const oldText = before.content.textContent, newText = after.content.textContent;
    const beforeStyles = [...before.content.querySelectorAll('[style]')].map(el => el.getAttribute('style'));
    const afterStyles = [...after.content.querySelectorAll('[style]')].map(el => el.getAttribute('style'));
    const comparison = compareBlocks(before.blocks, after.blocks);
    applyMarks(before, comparison.before); applyMarks(after, comparison.after);
    expect(before.content.textContent).toBe(oldText); expect(after.content.textContent).toBe(newText);
    for (const [doc, styles] of [[before, beforeStyles], [after, afterStyles]] as const) {
      expect([...doc.content.querySelectorAll('[style]')].map(el => el.getAttribute('style'))).toEqual(styles);
      expect(doc.content.querySelector('table')).not.toBeNull();
      expect(doc.content.querySelector('[data-diff]')).not.toBeNull();
      const styleText = doc.content.innerHTML;
      expect(styleText).toContain('color: rgb(201, 40, 65)');
      expect(styleText).toContain('color: rgb(35, 92, 196)');
      expect(styleText).toContain('background-color: yellow');
    }
    expect(before.blocks.join('')).not.toContain('EXAMPLE DOCUMENT');
    expect(before.content.textContent).toContain('EXAMPLE DOCUMENT');
    expect(before.blocks.join('')).toContain('Theoretical physics');
  });
  it('같은 파일을 두 번 읽어 비교하면 변경이 없다', async () => {
    const file = await sample('before');
    const a = await renderDocument(file, host(), 'before');
    const b = await renderDocument(file, host(), 'after');
    expect(compareBlocks(a.blocks, b.blocks).changes).toEqual([]);
  });
  it('Before 코멘트는 비교와 화면에서 제외하고 다시 포함하면 온전히 복원한다', async () => {
    const file = await sample('before');
    const full = await renderDocument(file, host(), 'before');
    const filtered = await renderDocument(file, host(), 'before', { ignoreOpeningComments: true });
    const restored = await renderDocument(file, host(), 'before', { ignoreOpeningComments: false });
    expect(full.blocks.join('')).toContain(OPENING_COMMENT_END);
    expect(filtered.blocks.join('')).not.toContain('Reviewer comments');
    expect(filtered.content.textContent).not.toContain(OPENING_COMMENT_END);
    expect(filtered.blocks[0]).toBe('Personal Statement\n');
    expect(filtered.warnings).toContain('Opening comments excluded from Before.');
    expect(restored.blocks).toEqual(full.blocks);
    const bodyStyles = (doc: typeof full) => [...doc.content.querySelectorAll('article p')]
      .filter(p => p.textContent?.startsWith('Physics has fascinated'))
      .map(p => p.innerHTML);
    expect(bodyStyles(filtered)).toEqual(bodyStyles(full));
    expect(filtered.content.querySelectorAll('section.docx')).toHaveLength(1);
  });
  it('After에 코멘트가 남아 있어도 Before 제외 옵션으로 After를 자르지 않는다', async () => {
    const doc = await renderDocument(await sample('before'), host(), 'after', { ignoreOpeningComments: true });
    expect(doc.blocks.join('')).toContain(OPENING_COMMENT_END);
    expect(doc.warnings.join('')).not.toContain('Opening comments excluded');
  });
  it('기준 문장이 없으면 전체 내용을 유지하고 안내한다', async () => {
    const file = await sample('after');
    const full = await renderDocument(file, host(), 'before');
    const filtered = await renderDocument(file, host(), 'before', { ignoreOpeningComments: true });
    expect(filtered.blocks).toEqual(full.blocks);
    expect(filtered.warnings.join('')).toContain('marker not found');
  });
  it('코멘트 제외 후 본문이 없으면 옵션 해제를 안내한다', async () => {
    const file = await sample('before');
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const xml = new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'), 'application/xml');
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const body = xml.getElementsByTagNameNS(ns, 'body')[0];
    const properties = body.getElementsByTagNameNS(ns, 'sectPr')[0].cloneNode(true);
    body.replaceChildren();
    const paragraph = xml.createElementNS(ns, 'w:p'), run = xml.createElementNS(ns, 'w:r'), text = xml.createElementNS(ns, 'w:t');
    text.textContent = OPENING_COMMENT_END; run.append(text); paragraph.append(run); body.append(paragraph, properties);
    zip.file('word/document.xml', new XMLSerializer().serializeToString(xml));
    const commentOnly = new File([await zip.generateAsync({ type: 'arraybuffer' })], 'comment-only.docx');
    await expect(renderDocument(commentOnly, host(), 'before', { ignoreOpeningComments: true })).rejects.toThrow('Turn off');
  });
  it('문단 끝 줄바꿈의 변경은 본문 전체에 배경색을 입히지 않는다', async () => {
    const doc = await renderDocument(await sample('before'), host(), 'before');
    const paragraph = doc.paragraphs[1];
    const originalText = paragraph.element.textContent;
    const originalStyle = paragraph.element.getAttribute('style');
    applyMarks(doc, [{ start: paragraph.end - 1, end: paragraph.end, change: 0 }]);
    expect(paragraph.element.hasAttribute('data-diff')).toBe(false);
    expect(paragraph.element.textContent).toBe(originalText);
    expect(paragraph.element.getAttribute('style')).toBe(originalStyle);
    expect(paragraph.element.querySelector('[data-diff="0"]')).not.toBeNull();
  });
  it('본문 색만 바뀐 파일은 글의 변경으로 오인하지 않는다', async () => {
    const file = await sample('before');
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    zip.file('word/document.xml', xml.replaceAll('C92841', '008800'));
    const changed = new File([await zip.generateAsync({ type: 'arraybuffer' })], 'color-only.docx');
    const a = await renderDocument(file, host(), 'before');
    const b = await renderDocument(changed, host(), 'after');
    expect(compareBlocks(a.blocks, b.blocks).changes).toEqual([]);
  });
  it('외부 링크는 연결하지 않으며 문서를 읽을 때 네트워크로 전송하지 않는다', async () => {
    const file = await sample('before');
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const relPath = 'word/_rels/document.xml.rels';
    const rels = await zip.file(relPath)!.async('string');
    zip.file(relPath, rels.replace('</Relationships>', '<Relationship Id="external-test" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/private" TargetMode="External"/></Relationships>'));
    const external = new File([await zip.generateAsync({ type: 'arraybuffer' })], 'external.docx');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const rendered = await renderDocument(external, host(), 'before');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rendered.warnings.join('')).toContain('External');
    expect(rendered.content.querySelector('a[href]')).toBeNull();
    fetchSpy.mockRestore();
  });
  it('추적 변경이 남은 문서는 잘못된 결과를 내는 대신 중단한다', async () => {
    const file = await sample('before');
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    zip.file('word/document.xml', xml.replace('<w:body>', '<w:body><w:p><w:ins w:id="1"><w:r><w:t>tracked</w:t></w:r></w:ins></w:p>'));
    const tracked = new File([await zip.generateAsync({ type: 'arraybuffer' })], 'tracked.docx');
    await expect(renderDocument(tracked, host(), 'before')).rejects.toThrow('tracked changes');
  });
  it('잘못된 파일과 과대 파일을 명확히 거부한다', async () => {
    expect(() => validateFile(new File(['text'], 'old.doc'))).toThrow('.docx');
    expect(() => validateFile(new File([], 'empty.docx'))).toThrow('empty');
    expect(() => validateFile(new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'huge.docx'))).toThrow('20 MB');
    await expect(renderDocument(new File(['not a zip'], 'broken.docx'), host(), 'before')).rejects.toThrow('.docx');
  });
});
