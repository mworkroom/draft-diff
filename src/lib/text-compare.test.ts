// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareBlocks } from './compare';
import { afterTextMarks, copyHighlightedText, DEFAULT_COPY_FORMAT, FORMAT_STORAGE_KEY, highlightedHtml, loadCopyFormat, textParts, validCopyFormat } from './text-compare';

function compare(before: string, after: string) {
  const result = compareBlocks([before], [after]);
  return { result, before: textParts(before, result.before), after: textParts(after, afterTextMarks(after, result)) };
}
const red = (parts: ReturnType<typeof textParts>) => parts.filter(part => part.changed).map(part => part.text);
const readBlob = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob);
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

describe('텍스트 비교와 삭제 위치 표시', () => {
  it('바뀐 단어만 표시한다', () => {
    const parts = compare('I gained practical experience.', 'I gained professional experience.');
    expect(red(parts.before)).toEqual(['practical']); expect(red(parts.after)).toEqual(['professional']);
  });
  it.each([
    ['the larger physical systems', 'the physical systems', 'p'],
    ['evolutionary biology, because', 'evolutionary biology because', 'y'],
    ['Newton then showed', 'Newton showed', 's'],
    ['valuable experience', 'experience', 'e'],
    ['I study biology today.', 'I study biology.', 'y'],
    ['biology,', 'biology', 'y'],
    ['then 𐐀bc', '𐐀bc', '𐐀'],
    ['then e\u0301lan', 'e\u0301lan', 'e\u0301'],
  ])('%s → %s 에서 인접 글자 %s만 표시한다', (before, after, expected) => {
    const parts = compare(before, after);
    expect(red(parts.after)).toEqual([expected]);
    expect(parts.after.map(part => part.text).join('')).toBe(after);
    const deletion = parts.result.changes.find(change => change.before && !change.after)!;
    expect(deletion.beforeStart).toBe(deletion.before?.start);
    expect(deletion.afterStart).toBeGreaterThanOrEqual(0);
  });
  it('순수 추가에는 Before에 가짜 글자를 칠하지 않는다', () => {
    const parts = compare('I study.', 'I study biology.');
    expect(red(parts.before)).toEqual([]); expect(red(parts.after).join('')).toContain('biology');
  });
  it('빈 입력, 완전 삭제, 완전 추가, 동일한 텍스트를 처리한다', () => {
    expect(compare('removed', '').after).toEqual([]);
    expect(compare('', 'added').after).toEqual([{ text: 'added', changed: true }]);
    expect(compare('', '').result.changes).toEqual([]);
    expect(red(compare('same', 'same').after)).toEqual([]);
  });
  it('반복 단어, 문장부호, 공백과 줄바꿈을 변경하지 않는다', () => {
    const before = '  repeat repeat\tpractical.\n\nLast line.  ';
    const after = '  repeat\tprofessional!\n\nLast line.  ';
    const parts = compare(before, after);
    expect(parts.before.map(part => part.text).join('')).toBe(before);
    expect(parts.after.map(part => part.text).join('')).toBe(after);
  });
  it('겹치는 삭제 표시와 변경 구간을 중복 출력하지 않는다', () => {
    expect(textParts('abcdef', [{ start: 1, end: 4, change: 0 }, { start: 2, end: 5, change: 1 }])).toEqual([
      { text: 'a', changed: false }, { text: 'bcde', changed: true }, { text: 'f', changed: false },
    ]);
  });
});

describe('Word 복사용 HTML과 설정', () => {
  it('출력 글꼴, 크기, 줄간격과 변경 부분의 빨간 글자색만 담는다', () => {
    const html = highlightedHtml(compare('old word', 'new word').after, DEFAULT_COPY_FORMAT);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.body.textContent).toBe('new word');
    expect(doc.querySelector('pre p')).not.toBeNull();
    expect(doc.querySelector('p')?.style.fontFamily).toContain('Times New Roman');
    expect(doc.querySelector('p')?.style.fontSize).toBe('12pt');
    expect(doc.querySelector('p')?.style.lineHeight).toBe('150%');
    expect(doc.querySelector('p')?.style.textIndent).toBe('1.27cm');
    expect(doc.querySelector('p')?.lang).toBe('en-US');
    expect(html).toContain('mso-ansi-language:EN-US');
    expect([...doc.querySelectorAll('span')].filter(el => el.style.color).map(el => el.textContent)).toEqual(['new']);
    expect(html).not.toMatch(/background|table|button/);
  });
  it('HTML 문자를 이스케이프하고 연속 공백·탭을 원래 문자로 유지한다', () => {
    const text = ' <script>"&\'</script>  \tend ';
    const html = highlightedHtml([{ text, changed: true }], DEFAULT_COPY_FORMAT);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('script')).toBeNull(); expect(doc.body.textContent).toBe(text);
    expect(html).not.toMatch(/&nbsp;|\u00a0/); expect(html).toContain('mso-spacerun:yes');
    expect(highlightedHtml([{ text: 'a\n\nb', changed: false }], DEFAULT_COPY_FORMAT)).toContain('a<br><br>b');
  });
  it('사용자 설정을 읽고 잘못된 설정과 CSS 주입을 거부한다', () => {
    const custom = { fontFamily: 'Arial', fontSizePt: 14, lineSpacing: 2, firstLineIndentCm: 0 };
    localStorage.setItem(FORMAT_STORAGE_KEY, JSON.stringify(custom)); expect(loadCopyFormat()).toEqual(custom);
    localStorage.setItem(FORMAT_STORAGE_KEY, '{'); expect(loadCopyFormat()).toEqual(DEFAULT_COPY_FORMAT);
    expect(validCopyFormat({ ...custom, fontFamily: 'Arial; color:red' })).toBe(false);
    expect(validCopyFormat({ ...custom, fontSizePt: NaN })).toBe(false);
    expect(validCopyFormat({ ...custom, lineSpacing: 0 })).toBe(false);
    expect(validCopyFormat({ ...custom, firstLineIndentCm: -1 })).toBe(false);
    expect(() => highlightedHtml([], { ...custom, fontFamily: '<img>' })).toThrow();
  });
  it('기존 저장 설정에 들여쓰기 기본값을 추가하고 철자를 바꾸지 않는다', () => {
    localStorage.setItem(FORMAT_STORAGE_KEY, JSON.stringify({ fontFamily: 'Arial', fontSizePt: 14, lineSpacing: 2 }));
    expect(loadCopyFormat()).toEqual({ fontFamily: 'Arial', fontSizePt: 14, lineSpacing: 2, firstLineIndentCm: 1.27 });
    const text = 'I realised the importance of colour.';
    const doc = new DOMParser().parseFromString(highlightedHtml([{ text, changed: false }], DEFAULT_COPY_FORMAT), 'text/html');
    expect(doc.body.textContent).toBe(text);
  });
  it('클립보드에 HTML과 정확한 일반 텍스트를 함께 기록한다', async () => {
    const text = '  A\tB\nC  ';
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { write } });
    vi.stubGlobal('ClipboardItem', class { constructor(public data: Record<string, Blob>) {} });
    await copyHighlightedText(text, [{ text, changed: false }], DEFAULT_COPY_FORMAT);
    const item = write.mock.calls[0][0][0];
    expect(Object.keys(item.data)).toEqual(['text/html', 'text/plain']);
    expect(await readBlob(item.data['text/plain'])).toBe(text);
    expect(await readBlob(item.data['text/html'])).toContain('Times New Roman');
  });
  it('거부·미지원에서는 성공으로 처리하거나 일반 텍스트로 조용히 대체하지 않는다', async () => {
    const write = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { clipboard: { write } });
    vi.stubGlobal('ClipboardItem', class {});
    await expect(copyHighlightedText('x', [], DEFAULT_COPY_FORMAT)).rejects.toThrow('denied');
    vi.stubGlobal('navigator', {});
    await expect(copyHighlightedText('x', [], DEFAULT_COPY_FORMAT)).rejects.toThrow('Formatted copying is unavailable');
  });
});
