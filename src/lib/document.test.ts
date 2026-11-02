// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { renderDocument, applyMarks, validateFile } from './document';
import { compareBlocks } from './compare';

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
