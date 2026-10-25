import {
  extractNfseFields,
  hasAnyField,
} from '../../../../src/modules/extraction/nfse/nfse-fields';
import { fromPdfTexts, layout } from '../testing/layout';
import { MUNICIPAL_NFSE, NATIONAL_DANFSE } from '../testing/nfse-layouts';

describe('extractNfseFields', () => {
  it('reads the national DANFSe', () => {
    expect(extractNfseFields(fromPdfTexts(NATIONAL_DANFSE))).toEqual({
      issueDate: '2026-10-13',
      grossAmount: 1500,
      number: '1287',
      taker: {
        name: 'CLINICA VETERINARIA EXEMPLO LTDA',
        taxId: '12345678000195',
      },
    });
  });

  it('reads a municipal layout with the value beside the label', () => {
    expect(extractNfseFields(fromPdfTexts(MUNICIPAL_NFSE))).toEqual({
      issueDate: '2026-10-05',
      grossAmount: 2350,
      number: '00000342',
      taker: {
        name: 'HOSPITAL VETERINARIO MODELO LTDA',
        taxId: '12345678000195',
      },
    });
  });

  it('answers only what it found', () => {
    const lines = layout([[40, [40, 'Relatório de atendimentos']]]);

    expect(extractNfseFields(lines)).toEqual({});
  });
});

describe('hasAnyField', () => {
  it('is false for no fields', () => {
    expect(hasAnyField({})).toBe(false);
  });

  it('is true for a single field', () => {
    expect(hasAnyField({ number: '1287' })).toBe(true);
  });
});
