import { describe, expect, it } from 'vitest';
import { compareBlocks, type Mark } from './compare';

function withoutMarks(text: string, marks: Mark[]) {
  let cursor = 0, clean = '';
  for (const mark of marks) { clean += text.slice(cursor, mark.start); cursor = mark.end; }
  return clean + text.slice(cursor);
}
function assertValid(before: string[], after: string[]) {
  const result = compareBlocks(before, after);
  const oldText = before.join(''), newText = after.join('');
  expect(withoutMarks(oldText, result.before)).toBe(withoutMarks(newText, result.after));
  for (const [text, marks] of [[oldText, result.before], [newText, result.after]] as const) {
    let previous = 0;
    for (const mark of marks) { expect(mark.start).toBeGreaterThanOrEqual(previous); expect(mark.end).toBeGreaterThan(mark.start); expect(mark.end).toBeLessThanOrEqual(text.length); previous = mark.end; }
  }
  return result;
}
describe('본문 비교와 원본 위치', () => {
  it('동일한 내용과 빈 입력에 변경 표시를 만들지 않는다', () => {
    expect(compareBlocks(['same\n'], ['same\n']).changes).toEqual([]);
    expect(compareBlocks([], []).changes).toEqual([]);
  });
  it('문장 안의 수정된 단어만 표시한다', () => {
    const result = assertValid(['I study physics.\n'], ['I study astronomy.\n']);
    expect(result.before.map(mark => 'I study physics.\n'.slice(mark.start, mark.end))).toEqual(['physics']);
    expect(result.after.map(mark => 'I study astronomy.\n'.slice(mark.start, mark.end))).toEqual(['astronomy']);
  });
  it('문단 삽입으로 뒤의 모든 문단을 변경 처리하지 않는다', () => {
    const result = assertValid(['intro\n', 'body\n', 'end\n'], ['intro\n', 'new paragraph\n', 'body\n', 'end\n']);
    expect(result.before).toEqual([]);
    expect(result.after).toHaveLength(1);
  });
  it('삭제만 있는 문서와 추가만 있는 문서를 처리한다', () => {
    expect(assertValid(['removed\n'], []).after).toEqual([]);
    expect(assertValid([], ['added\n']).before).toEqual([]);
  });
  it('문단 이동은 삭제와 추가로 표현한다', () => {
    const result = assertValid(['A\n', 'B\n', 'C\n'], ['B\n', 'C\n', 'A\n']);
    expect(result.before).toHaveLength(1); expect(result.after).toHaveLength(1);
  });
  it('한글·숫자·이모지·표 셀·빈 문단의 위치를 보존한다', () => {
    assertValid(['질문을 만들었습니다. 🌍\n', '\n', '학비\n', '£30,000\n'], ['질문을 구체화했습니다. 🌌\n', '학비\n', '£31,000\n']);
  });
  it('반복 문단이 많은 실제 크기의 문서에서도 공통 내용을 보존한다', () => {
    const before = Array.from({ length: 400 }, (_, i) => `Section ${i}: repeated words and a specific paragraph.\n`);
    const after = [...before]; after[125] = 'Section 125: newly revised paragraph.\n'; after.splice(270, 0, 'Extra section.\n');
    const result = assertValid(before, after);
    expect(result.changes.length).toBeGreaterThan(0); expect(result.changes.length).toBeLessThan(10);
  });
});
