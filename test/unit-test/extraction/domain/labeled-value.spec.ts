import { parseBrazilianDate } from '../../../../src/modules/extraction/domain/brazilian-formats';
import {
  findLabeledValues,
  fold,
} from '../../../../src/modules/extraction/domain/labeled-value';
import { layout } from '../testing/layout';

const DATE_LABEL = /\bdata de emissao\b/;

describe('fold', () => {
  it('lowercases and drops accents without changing the length', () => {
    const text = 'Data de Emissão · Nº';
    expect(fold(text)).toBe('data de emissao · nº');
    expect(fold(text)).toHaveLength(text.length);
  });
});

describe('findLabeledValues', () => {
  const values = (lines: ReturnType<typeof layout>, below?: boolean) =>
    findLabeledValues(lines, DATE_LABEL, parseBrazilianDate, { below }).map(
      match => match.value,
    );

  it('reads the value in the same cell, after the label', () => {
    expect(
      values(layout([[100, [40, 'Data de Emissão: 12/08/2026']]])),
    ).toEqual(['2026-08-12']);
  });

  it('reads the value in the next cell of the line', () => {
    const lines = layout([[100, [40, 'Data de Emissão'], [200, '12/08/2026']]]);
    expect(values(lines)).toEqual(['2026-08-12']);
  });

  it('reads the value boxed right below the label', () => {
    const lines = layout([
      [100, [40, 'DATA DE EMISSÃO'], [300, 'VALOR TOTAL']],
      [112, [40, '18/08/2026'], [300, '2.418,90']],
    ]);
    expect(values(lines)).toEqual(['2026-08-18']);
  });

  it('does not look below when told not to', () => {
    const lines = layout([
      [100, [40, 'DATA DE EMISSÃO']],
      [112, [40, '18/08/2026']],
    ]);
    expect(values(lines, false)).toEqual([]);
  });

  it('does not take a value from a line far below', () => {
    const lines = layout([
      [100, [40, 'DATA DE EMISSÃO']],
      [160, [40, '18/08/2026']],
    ]);
    expect(values(lines)).toEqual([]);
  });

  it('does not take a value from the next page', () => {
    const lines = [
      ...layout([[800, [40, 'DATA DE EMISSÃO']]], 1),
      ...layout([[805, [40, '18/08/2026']]], 2),
    ];
    expect(values(lines)).toEqual([]);
  });

  it('reaches past a line of another box to the value under the label', () => {
    const lines = layout([
      [100, [40, 'DATA DE EMISSÃO']],
      [106, [300, 'texto de outra caixa']],
      [112, [40, '18/08/2026']],
    ]);
    expect(values(lines)).toEqual(['2026-08-18']);
  });

  it('skips a label whose neighbours hold no value', () => {
    const lines = layout([[100, [40, 'Data de emissão'], [200, 'a definir']]]);
    expect(values(lines)).toEqual([]);
  });
});
