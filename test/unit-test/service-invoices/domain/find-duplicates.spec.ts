import { Prisma } from '@prisma/client';

import {
  duplicateCriteria,
  duplicateReason,
  NoteIdentity,
} from '../../../../src/modules/service-invoices/domain/find-duplicates';

const ISSUED = new Date('2026-10-13T00:00:00Z');

const note = (fields: Partial<NoteIdentity> = {}): NoteIdentity => ({
  amount: null,
  issueDate: null,
  number: null,
  clientId: null,
  takerTaxId: null,
  ...fields,
});

describe('duplicateCriteria', () => {
  it('compares amount and date only when both are filled in', () => {
    expect(
      duplicateCriteria(note({ amount: new Prisma.Decimal(1500) })),
    ).toBeNull();
    expect(
      duplicateCriteria(
        note({ amount: new Prisma.Decimal(1500), issueDate: ISSUED }),
      ),
    ).toEqual({
      amountAndDate: { amount: new Prisma.Decimal(1500), issueDate: ISSUED },
    });
  });

  it('compares the number only along with a taker', () => {
    expect(duplicateCriteria(note({ number: '1287' }))).toBeNull();
    expect(
      duplicateCriteria(
        note({
          number: '1287',
          clientId: 'client-1',
          takerTaxId: '12345678000195',
        }),
      ),
    ).toEqual({
      numberAndTaker: {
        number: '1287',
        clientId: 'client-1',
        takerTaxId: '12345678000195',
      },
    });
  });
});

describe('duplicateReason', () => {
  const read = note({
    amount: new Prisma.Decimal('1500.00'),
    issueDate: ISSUED,
    number: '1287',
  });

  it('names amount and date when both match', () => {
    expect(
      duplicateReason(
        read,
        note({ amount: new Prisma.Decimal(1500), issueDate: ISSUED }),
      ),
    ).toBe('SAME_AMOUNT_AND_DATE');
  });

  it('names number and taker otherwise', () => {
    expect(
      duplicateReason(
        read,
        note({ amount: new Prisma.Decimal(1500), number: '1287' }),
      ),
    ).toBe('SAME_NUMBER_AND_TAKER');
  });
});
