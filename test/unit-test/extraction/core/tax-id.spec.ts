import {
  findTaxId,
  unmaskTaxId,
} from '../../../../src/modules/extraction/core/tax-id';

describe('findTaxId', () => {
  it('finds a CNPJ', () => {
    expect(findTaxId('CNPJ: 12.345.678/0001-95')).toBe('12345678000195');
  });

  it('finds a CPF when there is no CNPJ', () => {
    expect(findTaxId('CPF: 987.654.321-00')).toBe('98765432100');
  });

  it('prefers the CNPJ when the text has both', () => {
    expect(findTaxId('987.654.321-00 / 12.345.678/0001-95')).toBe(
      '12345678000195',
    );
  });

  it('answers nothing for an invalid number', () => {
    expect(findTaxId('CPF: 987.654.321-01')).toBeUndefined();
  });
});

describe('unmaskTaxId', () => {
  it.each([
    ['11.222.333/0001-81', '11222333000181'],
    ['123.456.789-09', '12345678909'],
    ['12.abc.345/01de-35', '12ABC34501DE35'],
  ])('unmasks %p', (masked, unmasked) => {
    expect(unmaskTaxId(masked)).toBe(unmasked);
  });
});
