import {
  findDates,
  findMoneyValues,
  parseBrazilianDate,
  parseBrazilianNumber,
  parseLeadingNumber,
} from '../../../../src/modules/extraction/domain/brazilian-formats';

describe('parseBrazilianNumber', () => {
  it.each([
    ['1.234,56', 1234.56],
    ['R$ 1.234,56', 1234.56],
    ['R$\u00a02.418,90', 2418.9],
    ['94,50', 94.5],
    ['5,000', 5],
    ['2,5', 2.5],
    ['1.000', 1000],
    ['1.000.000', 1000000],
    ['12.5', 12.5],
    ['20', 20],
    ['-10,00', -10],
  ])('reads %p as %p', (raw, expected) => {
    expect(parseBrazilianNumber(raw)).toBe(expected);
  });

  it.each(['', 'CX', '5 CX', '1,2,3', '1.23.4', '12/08/2026', 'R$'])(
    'refuses %p instead of guessing',
    raw => {
      expect(parseBrazilianNumber(raw)).toBeUndefined();
    },
  );
});

describe('parseLeadingNumber', () => {
  it.each([
    ['5 CX', 5],
    ['20 fr', 20],
    ['R$ 18,90', 18.9],
    ['12,000 UN', 12],
  ])('takes the number out of %p', (text, expected) => {
    expect(parseLeadingNumber(text)).toBe(expected);
  });

  it.each(['informar', 'PROPOFOL 10MG/ML', 'CX 5', '10MG'])(
    'refuses %p, which does not start with a number',
    text => {
      expect(parseLeadingNumber(text)).toBeUndefined();
    },
  );
});

describe('findMoneyValues', () => {
  it('finds every amount with cents, in order', () => {
    expect(
      findMoneyValues('Subtotal R$ 2.388,90  Frete 30,00  Total R$ 2.418,90'),
    ).toEqual([2388.9, 30, 2418.9]);
  });

  it('ignores numbers without cents', () => {
    expect(findMoneyValues('12 itens, pedido 4521')).toEqual([]);
  });
});

describe('dates', () => {
  it.each([
    ['Data: 12/08/2026', '2026-08-12'],
    ['12/08/26', '2026-08-12'],
    ['01-02-2026', '2026-02-01'],
    ['5.3.2026', '2026-03-05'],
    ['Emissão 18/08/2026 11:07', '2026-08-18'],
  ])('reads %p as %p', (text, expected) => {
    expect(parseBrazilianDate(text)).toBe(expected);
  });

  it.each([
    ['Caxias do Sul, 8 de abril de 2026', '2026-04-08'],
    ['Emitido em 12 de março de 2026', '2026-03-12'],
    ['12 DE MARCO DE 2026', '2026-03-12'],
  ])('reads the written date in %p', (text, expected) => {
    expect(parseBrazilianDate(text)).toBe(expected);
  });

  it('orders written and numeric dates as they appear', () => {
    expect(
      findDates('Validade 18/04/2026, emitido em 8 de abril de 2026'),
    ).toEqual(['2026-04-18', '2026-04-08']);
  });

  it('skips a written date that does not exist', () => {
    expect(findDates('31 de fevereiro de 2026')).toEqual([]);
  });

  it('skips dates that do not exist', () => {
    expect(findDates('31/02/2026 e 29/02/2028')).toEqual(['2028-02-29']);
  });

  it('does not read a CNPJ as a date', () => {
    expect(findDates('CNPJ 11.222.333/0001-81')).toEqual([]);
  });
});
