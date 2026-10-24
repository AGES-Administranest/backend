import { readLabeledField } from '../../../../src/modules/extraction/core/labeled-field';
import {
  GROSS_AMOUNT,
  ISSUE_DATE,
  NOTE_NUMBER,
} from '../../../../src/modules/extraction/nfse/note-fields';
import { layout } from '../testing/layout';

describe('NOTE_NUMBER', () => {
  it('reads the number under its box', () => {
    const lines = layout([
      [80, [40, 'Número da NFS-e']],
      [92, [40, '1287']],
    ]);

    expect(readLabeledField(lines, NOTE_NUMBER)).toBe('1287');
  });

  it('reads the number beside its label, as printed', () => {
    const lines = layout([[70, [40, 'Nº da Nota: 00000342']]]);

    expect(readLabeledField(lines, NOTE_NUMBER)).toBe('00000342');
  });

  it('does not take the number of the DPS', () => {
    const lines = layout([
      [80, [40, 'Número da DPS']],
      [92, [40, '55']],
    ]);

    expect(readLabeledField(lines, NOTE_NUMBER)).toBeUndefined();
  });

  it('does not read the access key as the number', () => {
    const lines = layout([
      [50, [40, 'NFS-e Nº']],
      [62, [40, '43059032112345678000195000000000128726104738290341']],
    ]);

    expect(readLabeledField(lines, NOTE_NUMBER)).toBeUndefined();
  });
});

describe('ISSUE_DATE', () => {
  it('reads the issue date of the note, without its time', () => {
    const lines = layout([
      [80, [40, 'Data e Hora da emissão da NFS-e']],
      [92, [40, '13/10/2026 14:32:10']],
    ]);

    expect(readLabeledField(lines, ISSUE_DATE)).toBe('2026-10-13');
  });

  it('does not take the issue date of the DPS', () => {
    const lines = layout([
      [80, [40, 'Data e Hora da emissão da DPS']],
      [92, [40, '12/10/2026 18:05:44']],
    ]);

    expect(readLabeledField(lines, ISSUE_DATE)).toBeUndefined();
  });

  it('falls back to the competence when there is no issue date', () => {
    const lines = layout([
      [80, [40, 'Competência da NFS-e']],
      [92, [40, '01/10/2026']],
    ]);

    expect(readLabeledField(lines, ISSUE_DATE)).toBe('2026-10-01');
  });
});

describe('GROSS_AMOUNT', () => {
  it('reads the value of the service', () => {
    const lines = layout([
      [370, [40, 'Valor do Serviço']],
      [382, [40, 'R$ 1.500,00']],
    ]);

    expect(readLabeledField(lines, GROSS_AMOUNT)).toBe(1500);
  });

  it('reads the total of the note beside its label', () => {
    const lines = layout([[214, [40, 'VALOR TOTAL DA NOTA = R$ 2.350,00']]]);

    expect(readLabeledField(lines, GROSS_AMOUNT)).toBe(2350);
  });

  it('does not take the net amount', () => {
    const lines = layout([
      [370, [400, 'Valor Líquido da NFS-e']],
      [382, [400, 'R$ 1.470,00']],
    ]);

    expect(readLabeledField(lines, GROSS_AMOUNT)).toBeUndefined();
  });

  it('needs cents', () => {
    const lines = layout([[40, [40, 'Valor dos Serviços: 3 itens']]]);

    expect(readLabeledField(lines, GROSS_AMOUNT)).toBeUndefined();
  });
});
