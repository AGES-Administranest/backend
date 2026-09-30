import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ReplaceDraftLinesDto } from './dto/replace-draft-lines.dto';
import { UpdateDraftHeaderDto } from './dto/update-draft-header.dto';
import { fromIsoDate, toIsoDate } from './iso-date';

const orderDateErrors = async (orderDate: unknown) => {
  const errors = await validate(
    plainToInstance(UpdateDraftHeaderDto, { orderDate }),
  );
  return errors.filter(error => error.property === 'orderDate');
};

const expirationDateErrors = async (expirationDate: unknown) => {
  const [linesError] = await validate(
    plainToInstance(ReplaceDraftLinesDto, {
      lines: [{ description: 'PROPOFOL', expirationDate }],
    }),
  );
  return (
    linesError?.children?.[0]?.children?.filter(
      error => error.property === 'expirationDate',
    ) ?? []
  );
};

describe('draft dates', () => {
  describe.each([
    ['orderDate', orderDateErrors],
    ['expirationDate', expirationDateErrors],
  ])('%s', (_field, errorsFor) => {
    it('accepts a date written as YYYY-MM-DD', async () => {
      expect(await errorsFor('2027-05-31')).toHaveLength(0);
    });

    it.each([
      ['leaving it out', undefined],
      ['null, to clear it', null],
    ])('accepts %s', async (_label, value) => {
      expect(await errorsFor(value)).toHaveLength(0);
    });

    it.each([
      ['a day the month does not have', '2027-02-30'],
      ['the basic format', '20270531'],
      ['a week date', '2027-W05'],
      ['an ordinal date', '2027-152'],
      ['a year and month only', '2027-05'],
      ['a date and time', '2027-05-31T10:00:00Z'],
      ['text that is not a date', 'tomorrow'],
    ])('refuses %s', async (_label, value) => {
      expect(await errorsFor(value)).not.toHaveLength(0);
    });
  });

  it('keeps the day it was given on the way in and out', () => {
    expect(toIsoDate(fromIsoDate('2027-05-31'))).toBe('2027-05-31');
  });
});
