import { Prisma } from '@prisma/client';

import { costPerKm, formatCostPerKm } from './vehicle-cost';

describe('costPerKm', () => {
  it.each([
    ['5.899', '12.5', '0.47192'],
    ['6.29', '10', '0.629'],
    ['4.5', '9', '0.5'],
    ['5', '3', '1.6666666666666666667'],
    ['6.199', '13.7', '0.45248175182481751825'],
  ])('%s R$/L at %s km/L costs %s R$/km', (price, consumption, expected) => {
    expect(costPerKm(price, consumption).toString()).toBe(expected);
  });

  it('accepts the Decimal values Prisma hands back', () => {
    const result = costPerKm(
      new Prisma.Decimal('5.899'),
      new Prisma.Decimal('12.50'),
    );

    expect(result).toBeInstanceOf(Prisma.Decimal);
    expect(result.toString()).toBe('0.47192');
  });

  it('keeps exact decimals where floating point would drift', () => {
    // 0.3 / 3 in binary floating point is 0.09999999999999999.
    expect(0.3 / 3).not.toBe(0.1);
    expect(costPerKm('0.3', '3').toString()).toBe('0.1');
  });

  it('keeps full precision, so a trip cost is not built on a rounded value', () => {
    const perKm = costPerKm('5.899', '12.5');
    const tripOf300Km = perKm.times(300);

    expect(tripOf300Km.toString()).toBe('141.576');
    expect(
      new Prisma.Decimal(formatCostPerKm(perKm)).times(300).toString(),
    ).toBe('141.57');
  });

  it.each(['0', '-1', 0, -12.5])('refuses a consumption of %s', consumption => {
    expect(() => costPerKm('5.899', consumption)).toThrow(RangeError);
  });
});

describe('formatCostPerKm', () => {
  it.each([
    ['0.47192', '0.4719'],
    ['0.12345', '0.1235'],
    ['0.12344', '0.1234'],
    ['0.629', '0.6290'],
    ['0.5', '0.5000'],
    ['1.99995', '2.0000'],
    ['1.6666666666666666667', '1.6667'],
  ])('%s becomes %s', (value, expected) => {
    expect(formatCostPerKm(value)).toBe(expected);
  });

  it('never answers in exponent notation, even for a tiny cost', () => {
    const tiny = costPerKm('0.001', '9999.99');

    expect(tiny.toString()).toContain('e-');
    expect(formatCostPerKm(tiny)).toBe('0.0000');
  });
});
