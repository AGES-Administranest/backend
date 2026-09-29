import { findCnpjs, isValidCnpj } from './cnpj';

describe('isValidCnpj', () => {
  it.each([
    '11222333000181',
    '12345678000195',
    '12ABC34501DE35',
    '12abc34501de35',
  ])('accepts %p', cnpj => {
    expect(isValidCnpj(cnpj)).toBe(true);
  });

  it.each([
    ['a wrong first check digit', '11222333000191'],
    ['a wrong second check digit', '11222333000182'],
    ['all digits equal, which passes the arithmetic', '11111111111111'],
    ['letters in the check digits', '12ABC34501DE3A'],
    ['the wrong length', '1122233300018'],
  ])('refuses %s', (_, cnpj) => {
    expect(isValidCnpj(cnpj)).toBe(false);
  });
});

describe('findCnpjs', () => {
  it('finds masked and unmasked CNPJs, unmasked, in order', () => {
    expect(
      findCnpjs('Emitente 11.222.333/0001-81 · cliente 12345678000195'),
    ).toEqual(['11222333000181', '12345678000195']);
  });

  it('finds the alphanumeric CNPJ when it is masked', () => {
    expect(findCnpjs('CNPJ: 12.ABC.345/01DE-35')).toEqual(['12ABC34501DE35']);
  });

  it('skips a well-formed CNPJ whose check digits fail', () => {
    expect(findCnpjs('CNPJ: 11.222.333/0001-99')).toEqual([]);
  });

  it('does not pull a CNPJ out of a longer run of digits', () => {
    // A NF-e access key: 44 digits, with a valid CNPJ inside it.
    const accessKey = `4326081122233300018155001000008841100884110`;
    expect(findCnpjs(accessKey)).toEqual([]);
  });

  it('reports a CNPJ printed twice only once', () => {
    expect(findCnpjs('11.222.333/0001-81 ... 11222333000181')).toEqual([
      '11222333000181',
    ]);
  });
});
