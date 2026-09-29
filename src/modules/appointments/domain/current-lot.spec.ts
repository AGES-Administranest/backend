import { Prisma } from '@prisma/client';

import { currentLot, LotLike } from './current-lot';

const lot = (
  id: string,
  overrides: Partial<Omit<LotLike, 'id'>> = {},
): LotLike => ({
  id,
  unitCost: new Prisma.Decimal(10),
  currentQuantity: new Prisma.Decimal(5),
  expirationDate: null,
  receivedOn: new Date('2026-09-01'),
  createdAt: new Date('2026-09-01T12:00:00.000Z'),
  ...overrides,
});

describe('currentLot', () => {
  it('returns null when the item has no lot', () => {
    expect(currentLot([])).toBeNull();
  });

  it('picks the lot with stock that expires first', () => {
    const lots = [
      lot('late', { expirationDate: new Date('2027-06-30') }),
      lot('early', { expirationDate: new Date('2026-12-31') }),
    ];

    expect(currentLot(lots)?.id).toBe('early');
  });

  it('ignores a lot that expires first but has no stock left', () => {
    const lots = [
      lot('empty', {
        expirationDate: new Date('2026-10-01'),
        currentQuantity: new Prisma.Decimal(0),
      }),
      lot('stocked', { expirationDate: new Date('2027-01-01') }),
    ];

    expect(currentLot(lots)?.id).toBe('stocked');
  });

  it('puts lots without an expiration date after dated ones', () => {
    const lots = [
      lot('undated', { receivedOn: new Date('2026-01-01') }),
      lot('dated', { expirationDate: new Date('2030-01-01') }),
    ];

    expect(currentLot(lots)?.id).toBe('dated');
  });

  it.each([
    [
      'the same expiration date',
      new Date('2026-12-31'),
      new Date('2026-12-31'),
    ],
    ['no expiration date on either', null, null],
  ])(
    'breaks a tie on %s by the oldest received lot',
    (_label, firstExpiration, secondExpiration) => {
      const lots = [
        lot('newer', {
          expirationDate: firstExpiration,
          receivedOn: new Date('2026-09-10'),
        }),
        lot('older', {
          expirationDate: secondExpiration,
          receivedOn: new Date('2026-08-10'),
        }),
      ];

      expect(currentLot(lots)?.id).toBe('older');
    },
  );

  it('falls back to the most recently received lot when none holds stock', () => {
    const lots = [
      lot('old', {
        currentQuantity: new Prisma.Decimal(0),
        receivedOn: new Date('2026-05-01'),
      }),
      lot('negative', {
        currentQuantity: new Prisma.Decimal(-2),
        receivedOn: new Date('2026-09-01'),
      }),
    ];

    expect(currentLot(lots)?.id).toBe('negative');
  });
});
