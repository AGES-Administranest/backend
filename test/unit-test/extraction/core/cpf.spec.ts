import {
  findCpfs,
  isValidCpf,
} from '../../../../src/modules/extraction/core/cpf';

describe('isValidCpf', () => {
  it.each(['12345678909', '98765432100', '11144477735'])('accepts %p', cpf => {
    expect(isValidCpf(cpf)).toBe(true);
  });

  it.each([
    ['a wrong first check digit', '12345678919'],
    ['a wrong second check digit', '12345678908'],
    ['all digits equal, which passes the arithmetic', '11111111111'],
    ['the wrong length', '1234567890'],
    ['a mask', '123.456.789-09'],
  ])('refuses %s', (_, cpf) => {
    expect(isValidCpf(cpf)).toBe(false);
  });
});

describe('findCpfs', () => {
  it('finds masked and unmasked CPFs, unmasked, in order', () => {
    expect(findCpfs('CPF 123.456.789-09 · outro 98765432100')).toEqual([
      '12345678909',
      '98765432100',
    ]);
  });

  it('skips a well-formed CPF whose check digits fail', () => {
    expect(findCpfs('CPF: 123.456.789-00')).toEqual([]);
  });

  it('does not take 11 digits out of a longer number', () => {
    expect(findCpfs('43059032112345678909000000000128')).toEqual([]);
  });

  it('answers each CPF once', () => {
    expect(findCpfs('123.456.789-09 e 12345678909')).toEqual(['12345678909']);
  });
});
