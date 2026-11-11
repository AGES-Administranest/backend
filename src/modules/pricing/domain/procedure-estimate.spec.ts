import { Prisma } from '@prisma/client';

import {
  estimateProcedure,
  ProcedureEstimateInput,
} from './procedure-estimate';

const decimal = (value: string) => new Prisma.Decimal(value);

const input = (
  overrides: Partial<ProcedureEstimateInput> = {},
): ProcedureEstimateInput => ({
  durationMinutes: 120,
  hourlyRate: '60.29',
  minimumHourlyRate: '54.81',
  tripCostPerDay: null,
  supplies: [],
  ...overrides,
});

const text = (estimate: ReturnType<typeof estimateProcedure>) => ({
  minimumPrice: estimate.minimumPrice.toFixed(2),
  breakEvenPrice: estimate.breakEvenPrice.toFixed(2),
  hoursCost: estimate.hoursCost.toFixed(2),
  tripCost: estimate.tripCost.toFixed(2),
  suppliesCost: estimate.suppliesCost.toFixed(2),
});

describe('estimateProcedure', () => {
  it('adds the hours, the trip and the supplies', () => {
    const estimate = estimateProcedure(
      input({
        tripCostPerDay: '60',
        supplies: [
          { itemId: 'item-1', quantity: 2, unitCost: decimal('12.5') },
          { itemId: 'item-2', quantity: '0.5', unitCost: decimal('40') },
        ],
      }),
    );

    expect(text(estimate)).toEqual({
      minimumPrice: '225.58',
      breakEvenPrice: '214.62',
      hoursCost: '120.58',
      tripCost: '60.00',
      suppliesCost: '45.00',
    });
  });

  it.each([
    [60, '60.29'],
    [90, '90.44'],
    [45, '45.22'],
    [1, '1.00'],
    [1440, '1446.96'],
  ])('prices %i minutes at 60.29 an hour as %s', (minutes, expected) => {
    expect(
      estimateProcedure(input({ durationMinutes: minutes })).hoursCost.toFixed(
        2,
      ),
    ).toBe(expected);
  });

  it('rounds each part half-up to cents and adds the rounded parts', () => {
    // 50 × 10 ÷ 60 = 8.3333…; 0.125 × 1 = 0.125; 10.005 per day.
    const estimate = estimateProcedure(
      input({
        durationMinutes: 10,
        hourlyRate: '50',
        tripCostPerDay: '10.005',
        supplies: [
          { itemId: 'item-1', quantity: 1, unitCost: decimal('0.125') },
        ],
      }),
    );

    expect(text(estimate)).toMatchObject({
      hoursCost: '8.33',
      tripCost: '10.01',
      suppliesCost: '0.13',
      minimumPrice: '18.47',
    });
  });

  it('prices the break-even with the rate without the margin', () => {
    const estimate = estimateProcedure(input({ tripCostPerDay: '20' }));

    // 54.81 × 2 = 109.62, plus the same 20 of trip.
    expect(estimate.breakEvenPrice.toFixed(2)).toBe('129.62');
    expect(estimate.minimumPrice.toFixed(2)).toBe('140.58');
  });

  it('adds nothing for the trip without an estimate', () => {
    expect(estimateProcedure(input()).tripCost.toFixed(2)).toBe('0.00');
  });

  it('counts an item without a cost at 0 and lists it once', () => {
    const estimate = estimateProcedure(
      input({
        supplies: [
          { itemId: 'no-cost', quantity: 1, unitCost: null },
          { itemId: 'priced', quantity: 3, unitCost: decimal('2.5') },
          { itemId: 'no-cost', quantity: 2, unitCost: null },
        ],
      }),
    );

    expect(estimate.suppliesCost.toFixed(2)).toBe('7.50');
    expect(estimate.suppliesWithoutCost).toEqual(['no-cost']);
  });

  it('adds up an item listed on several lines', () => {
    const estimate = estimateProcedure(
      input({
        supplies: [
          { itemId: 'item-1', quantity: 1, unitCost: decimal('3.3333') },
          { itemId: 'item-1', quantity: 2, unitCost: decimal('3.3333') },
        ],
      }),
    );

    // 3 × 3.3333 = 9.9999, rounded once.
    expect(estimate.suppliesCost.toFixed(2)).toBe('10.00');
  });

  it('keeps exact decimals where floating point would drift', () => {
    // 0.1 × 3 in binary floating point is 0.30000000000000004.
    const estimate = estimateProcedure(
      input({
        supplies: [
          { itemId: 'item-1', quantity: '0.1', unitCost: decimal('3') },
        ],
      }),
    );

    expect(estimate.suppliesCost.toString()).toBe('0.3');
  });

  it.each([0, -30, 1.5])('rejects a duration of %s minutes', minutes => {
    expect(() =>
      estimateProcedure(input({ durationMinutes: minutes })),
    ).toThrow(RangeError);
  });
});
