import {
  escapeLike,
  parseSearch,
} from '../../../../src/modules/service-invoices/domain/search';

describe('parseSearch', () => {
  it.each([undefined, '', '   '])('is no search for %j', raw => {
    expect(parseSearch(raw)).toBeNull();
  });

  it('keeps a name as text only', () => {
    expect(parseSearch('  Hosp Vét ')).toEqual({ text: 'Hosp Vét' });
  });

  it.each([
    ['22/04', '2204'],
    ['2204', '2204'],
    ['04/2026', '042026'],
    ['22/04/2026', '22042026'],
    ['458', '458'],
  ])('reads %j as a date by its digits %j', (raw, dateDigits) => {
    expect(parseSearch(raw)).toEqual({ text: raw, dateDigits });
  });

  it.each(['2', '/', '0', 'NF 22', 'a22/04'])(
    'does not read %j as a date',
    raw => {
      expect(parseSearch(raw)).not.toHaveProperty('dateDigits');
    },
  );
});

describe('escapeLike', () => {
  it('turns the wildcards into letters', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});
