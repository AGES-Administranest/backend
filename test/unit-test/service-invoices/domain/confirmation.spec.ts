import { Prisma } from '@prisma/client';

import {
  dueDateOf,
  missingForConfirmation,
} from '../../../../src/modules/service-invoices/domain/confirmation';

describe('missingForConfirmation', () => {
  const ready = {
    issueDate: new Date('2026-10-13T00:00:00Z'),
    amount: new Prisma.Decimal(1500),
    clientId: 'client-1',
  };

  it('asks for nothing once the date, a positive amount and the client are there', () => {
    expect(missingForConfirmation(ready)).toEqual([]);
  });

  it('lists every field still missing', () => {
    expect(
      missingForConfirmation({ issueDate: null, amount: null, clientId: null }),
    ).toEqual(['issueDate', 'amount', 'clientId']);
  });

  it('takes an amount of zero as missing', () => {
    expect(
      missingForConfirmation({ ...ready, amount: new Prisma.Decimal(0) }),
    ).toEqual(['amount']);
  });
});

describe('dueDateOf', () => {
  it('counts the payment terms from the issue date', () => {
    expect(dueDateOf(new Date('2026-10-13T00:00:00Z'), 30)).toEqual(
      new Date('2026-11-12T00:00:00Z'),
    );
  });

  it('crosses the year', () => {
    expect(dueDateOf(new Date('2026-12-20T00:00:00Z'), 15)).toEqual(
      new Date('2027-01-04T00:00:00Z'),
    );
  });

  it('has no due date when the client has no terms', () => {
    expect(dueDateOf(new Date('2026-10-13T00:00:00Z'), null)).toBeNull();
  });
});
