import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, Header, Footer, AlignmentType, WidthType } from 'docx';
import { mkdir, writeFile } from 'node:fs/promises';

const out = new URL('../public/samples/', import.meta.url);
await mkdir(out, { recursive: true });
const run = (text, options = {}) => new TextRun({ text, ...options });
const p = children => new Paragraph({ children, spacing: { after: 240, line: 360 } });
function make(after) {
  return new Document({
    creator: 'DraftDiff', title: 'Personal Statement · Comparison Example',
    styles: { default: { document: { run: { font: 'Georgia', size: 24 }, paragraph: { spacing: { line: 360 } } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
      headers: { default: new Header({ children: [new Paragraph({ children: [run('EXAMPLE DOCUMENT', { color: '718096', size: 18 })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run('DraftDiff · Synthetic example document', { font: 'Malgun Gothic', size: 18, color: '718096' })] })] }) },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [run('Personal Statement', { bold: true, size: 38 })] }),
        p([run('Physics has fascinated me since '), run(after ? 'middle school' : 'high school', { color: 'C92841' }), run(', when I first encountered the elegant way in which simple principles can explain complex phenomena. Through textbooks and '), run(after ? 'hands-on experiments' : 'experiments'), run(', I have learned to appreciate how '), run(after ? 'the physical world' : 'the natural world', { color: '235CC4' }), run(' follows consistent rules, and this understanding continues to drive my curiosity.')]),
        p([run('During my undergraduate studies, I took '), run(after ? '4' : '3', { highlight: 'yellow', bold: true }), run(' advanced physics courses, including quantum mechanics, statistical physics, and electromagnetism. These courses strengthened my analytical skills and deepened my interest in exploring fundamental questions about the universe.')]),
        p([run('Looking ahead, I hope to contribute to the field by pursuing research on '), run(after ? 'astrophysics' : 'theoretical physics', { bold: true }), run('. I am particularly interested in how '), run(after ? 'fundamental particles and forces' : 'fundamental particles', { color: 'C92841' }), run(' interact and give rise to the structure of our universe.')]),
        p([run('Research experience: ', { font: 'Malgun Gothic', bold: true }), run(after ? 'I refined my questions through observation and experiments.' : 'I developed questions through observation.', { font: 'Malgun Gothic', color: '235CC4' })]),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
          new TableRow({ children: ['Item', 'Details'].map(text => new TableCell({ children: [p([run(text, { bold: true, font: 'Malgun Gothic' })])] })) }),
          new TableRow({ children: ['Research interest', after ? 'Astrophysics' : 'Theoretical physics'].map(text => new TableCell({ children: [p([run(text, { font: 'Malgun Gothic' })])] })) }),
        ] }),
      ],
    }],
  });
}
for (const side of ['before', 'after']) await writeFile(new URL(`${side}.docx`, out), await Packer.toBuffer(make(side === 'after')));
console.log('Created synthetic DOCX examples (no personal data).');
