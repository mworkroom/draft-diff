// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { excludeOpeningComments, OPENING_COMMENT_END } from './opening-comments';

const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const wrap = (body: string) => `<w:document xmlns:w="${NS}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`;
const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const parse = (text: string) => new DOMParser().parseFromString(text, 'application/xml');
const text = (xml: string) => [...parse(xml).getElementsByTagNameNS(NS, 't')].map(t => t.textContent).join('');

describe('감수 코멘트 앞부분 제외', () => {
  it('기준 문장이 없으면 원본 XML을 그대로 반환한다', () => {
    const xml = wrap(p('No reviewer comments here.'));
    expect(excludeOpeningComments(xml)).toEqual({ xml, removed: false });
  });
  it('기준 문장을 포함해 앞부분을 제거하고 본문과 구역 설정을 보존한다', () => {
    const result = excludeOpeningComments(wrap(p('Long introductory feedback.') + p(OPENING_COMMENT_END) + p('Body text.')));
    expect(result.removed).toBe(true); expect(text(result.xml)).toBe('Body text.');
    expect(parse(result.xml).getElementsByTagNameNS(NS, 'sectPr')).toHaveLength(1);
  });
  it('서로 다른 글자 서식·문단·공백·보이지 않는 공백으로 나뉜 문장도 찾는다', () => {
    const marker = '<w:p><w:r><w:t>단락 앞 숫자는</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t> 기존\u200b 단락</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>순서입니다 .</w:t></w:r></w:p>';
    const result = excludeOpeningComments(wrap(p('Feedback.') + marker + p('Body.')));
    expect(result.removed).toBe(true); expect(text(result.xml)).toBe('Body.');
  });
  it('기준 문장 뒤 같은 문단에 남은 글의 문단·글자 서식을 유지한다', () => {
    const body = `<w:p><w:pPr><w:pStyle w:val="BodyStyle"/><w:spacing w:after="180"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="C92841"/></w:rPr><w:t xml:space="preserve">Feedback. ${OPENING_COMMENT_END} Body stays red and bold.</w:t></w:r></w:p>`;
    const result = excludeOpeningComments(wrap(body));
    const xml = parse(result.xml);
    expect(text(result.xml)).toBe(' Body stays red and bold.');
    expect(xml.getElementsByTagNameNS(NS, 'pStyle')[0].getAttributeNS(NS, 'val')).toBe('BodyStyle');
    expect(xml.getElementsByTagNameNS(NS, 'color')[0].getAttributeNS(NS, 'val')).toBe('C92841');
    expect(xml.getElementsByTagNameNS(NS, 'b')).toHaveLength(1);
    expect(xml.getElementsByTagNameNS(NS, 'spacing')[0].getAttributeNS(NS, 'after')).toBe('180');
  });
  it('앞쪽 빈 문단과 이전 페이지 나눔만 제거하고 뒤쪽 페이지 나눔은 유지한다', () => {
    const body = p('Feedback.') + p(OPENING_COMMENT_END) + p('   ')
      + '<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:br w:type="page"/><w:lastRenderedPageBreak/><w:t>First body.</w:t></w:r></w:p>'
      + '<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:br w:type="page"/><w:t>Later body.</w:t></w:r></w:p>';
    const result = excludeOpeningComments(wrap(body));
    const xml = parse(result.xml);
    expect(text(result.xml)).toBe('First body.Later body.');
    expect(xml.getElementsByTagNameNS(NS, 'p')).toHaveLength(2);
    expect(xml.getElementsByTagNameNS(NS, 'br')).toHaveLength(1);
    expect(xml.getElementsByTagNameNS(NS, 'pageBreakBefore')).toHaveLength(1);
    expect(xml.getElementsByTagNameNS(NS, 'lastRenderedPageBreak')).toHaveLength(0);
  });
  it('예외의 추가 안내와 남은 본문은 추측해서 삭제하지 않는다', () => {
    const result = excludeOpeningComments(wrap(p(OPENING_COMMENT_END) + p('(Additional instructions.)') + p('Body.')));
    expect(text(result.xml)).toBe('(Additional instructions.)Body.');
  });
  it('첫 번째 기준 문장에서 멈추고 본문에 다시 나오는 같은 문장은 유지한다', () => {
    const result = excludeOpeningComments(wrap(p(OPENING_COMMENT_END) + p('Body. ' + OPENING_COMMENT_END)));
    expect(text(result.xml)).toBe('Body. ' + OPENING_COMMENT_END);
  });
});
