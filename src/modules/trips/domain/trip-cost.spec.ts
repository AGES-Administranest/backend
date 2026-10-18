import { Prisma } from '@prisma/client';

import { snapshotCostPerKm, tripCost } from './trip-cost';

describe('snapshotCostPerKm', () => {
  it.each([
    ['5.899', '12.5', '0.4719'],
    ['6.29', '10', '0.629'],
    ['5', '3', '1.6667'],
    ['0.001', '100', '0'],
  ])(
    '%s R$/L at %s km/L is copied as %s R$/km',
    (price, consumption, expected) => {
      expect(snapshotCostPerKm(price, consumption).toString()).toBe(expected);
    },
  );

  it('rounds half-up at the fifth place', () => {
    // 0.12345 is the exact quotient, so half-up decides it.
    expect(snapshotCostPerKm('1.2345', '10').toString()).toBe('0.1235');
  });
});

describe('tripCost', () => {
  it.each([
    ['30', '0.4719', '14.16'],
    ['12.5', '0.629', '7.86'],
    ['1', '0.005', '0.01'],
    ['8.4', '0.4988', '4.19'],
  ])('%s km at %s R$/km costs %s', (distance, perKm, expected) => {
    expect(tripCost(distance, perKm).toString()).toBe(expected);
  });

  it('equals distance × the copied cost per km, not the raw price over the consumption', () => {
    const perKm = snapshotCostPerKm('5.899', '12.5');

    expect(tripCost('300', perKm).toString()).toBe('141.57');
    // 5.899 / 12.5 × 300 is 141.576, which would round to 141.58.
    expect(
      new Prisma.Decimal('5.899').dividedBy('12.5').times(300).toString(),
    ).toBe('141.576');
  });

  it('can come out as zero for a very short trip', () => {
    expect(tripCost('0.01', '0.4719').toString()).toBe('0');
  });

  it.each([
    ['0.5', '2.01', '1.01'],
    ['4.35', '0.1', '0.44'],
  ])(
    'rounds %s km at %s R$/km to %s, where floating point would drift',
    (distance, perKm, expected) => {
      expect((Number(distance) * Number(perKm)).toFixed(2)).not.toBe(expected);
      expect(tripCost(distance, perKm).toString()).toBe(expected);
    },
  );

  it('accepts the Decimal values Prisma hands back', () => {
    const result = tripCost(
      new Prisma.Decimal('30.00'),
      new Prisma.Decimal('0.4719'),
    );

    expect(result).toBeInstanceOf(Prisma.Decimal);
    expect(result.toString()).toBe('14.16');
  });

  it.each(['0', '-1'])('rejects a distance of %s km', distance => {
    expect(() => tripCost(distance, '0.4719')).toThrow(RangeError);
  });
});
