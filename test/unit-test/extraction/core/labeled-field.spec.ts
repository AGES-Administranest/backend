import {
  anyWord,
  LabeledField,
  readLabeledField,
} from '../../../../src/modules/extraction/core/labeled-field';
import { layout } from '../testing/layout';

const DUE_OR_ISSUE_DAY: LabeledField<string> = {
  labels: [/\bemissao\b/, /\bdata\b/],
  notThisField: anyWord(['vencimento']),
  parse: text => /\d{2}\/\d{2}/.exec(text)?.[0],
};

describe('readLabeledField', () => {
  it('takes the value of the first label in priority order', () => {
    const lines = layout([
      [40, [40, 'Data: 01/10']],
      [52, [40, 'Emissão: 05/10']],
    ]);

    expect(readLabeledField(lines, DUE_OR_ISSUE_DAY)).toBe('05/10');
  });

  it('skips label cells that name another value', () => {
    const lines = layout([
      [40, [40, 'Data de vencimento: 30/10']],
      [52, [40, 'Data: 05/10']],
    ]);

    expect(readLabeledField(lines, DUE_OR_ISSUE_DAY)).toBe('05/10');
  });

  it('answers nothing when no label has a value', () => {
    const lines = layout([[40, [40, 'Emissão: a confirmar']]]);

    expect(readLabeledField(lines, DUE_OR_ISSUE_DAY)).toBeUndefined();
  });
});

describe('anyWord', () => {
  const pattern = anyWord(['iss', 'base de calculo']);

  it.each(['valor do iss', 'base  de calculo'])('matches %p', text => {
    expect(pattern.test(text)).toBe(true);
  });

  it('matches whole words only', () => {
    expect(pattern.test('issqn retido')).toBe(false);
  });
});
