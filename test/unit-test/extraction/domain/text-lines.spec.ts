import {
  groupLines,
  lineText,
  TextFragment,
} from '../../../../src/modules/extraction/domain/text-lines';
import { fragment } from '../testing/layout';

const cellsOf = (fragments: TextFragment[]) =>
  groupLines([{ page: 1, fragments }]).map(line =>
    line.cells.map(cell => cell.text),
  );

describe('groupLines', () => {
  it('keeps fragments whose baselines drift a point on the same line', () => {
    const lines = cellsOf([
      fragment('Descrição', 40, 100),
      fragment('Qtd', 300, 101),
      fragment('Total', 480, 99.5),
    ]);

    expect(lines).toEqual([['Descrição', 'Qtd', 'Total']]);
  });

  it('orders lines top to bottom and cells left to right', () => {
    const lines = cellsOf([
      fragment('94,50', 480, 115),
      fragment('Total', 480, 100),
      fragment('PROPOFOL', 40, 115),
      fragment('Descrição', 40, 100),
    ]);

    expect(lines).toEqual([
      ['Descrição', 'Total'],
      ['PROPOFOL', '94,50'],
    ]);
  });

  it('joins the words of one value and splits values a column apart', () => {
    // "PROPOFOL" ends at 80; "10MG/ML" sits one space after it.
    const lines = cellsOf([
      fragment('PROPOFOL', 40, 100),
      fragment('10MG/ML', 85, 100),
      fragment('5', 300, 100),
    ]);

    expect(lines).toEqual([['PROPOFOL 10MG/ML', '5']]);
  });

  it('glues a word the PDF broke into touching fragments', () => {
    const lines = cellsOf([
      fragment('PROPO', 40, 100),
      fragment('FOL', 65, 100),
    ]);

    expect(lines).toEqual([['PROPOFOL']]);
  });

  it('drops the whitespace-only runs pdf.js emits between words', () => {
    const lines = cellsOf([
      fragment('Qtd', 300, 100),
      fragment(' ', 315, 100),
      fragment('Total', 480, 100),
    ]);

    expect(lines).toEqual([['Qtd', 'Total']]);
  });

  it('reads a run padded with spaces as separate columns', () => {
    const lines = cellsOf([
      fragment('Pedido: 4521     Data: 12/08/2026', 40, 100),
    ]);

    expect(lines).toEqual([['Pedido: 4521', 'Data: 12/08/2026']]);
  });

  it('does not double a run drawn twice to fake bold', () => {
    const lines = cellsOf([
      fragment('TOTAL', 40, 100),
      fragment('TOTAL', 40.4, 100),
    ]);

    expect(lines).toEqual([['TOTAL']]);
  });

  it('keeps pages apart even when their lines share a y', () => {
    const lines = groupLines([
      { page: 1, fragments: [fragment('primeira', 40, 100)] },
      { page: 2, fragments: [fragment('segunda', 40, 100)] },
    ]);

    expect(lines.map(line => [line.page, lineText(line)])).toEqual([
      [1, 'primeira'],
      [2, 'segunda'],
    ]);
  });

  it('records where each cell and each of its runs starts and ends', () => {
    const [line] = groupLines([
      {
        page: 1,
        fragments: [
          fragment('SORO FISIOL', 40, 100),
          fragment('HI25', 100, 100),
          fragment('18,90', 380, 100),
        ],
      },
    ]);

    expect(line.cells).toEqual([
      {
        text: 'SORO FISIOL HI25',
        x0: 40,
        x1: 120,
        runs: [
          { start: 0, end: 11, x0: 40, x1: 95 },
          { start: 12, end: 16, x0: 100, x1: 120 },
        ],
      },
      {
        text: '18,90',
        x0: 380,
        x1: 405,
        runs: [{ start: 0, end: 5, x0: 380, x1: 405 }],
      },
    ]);
  });
});
