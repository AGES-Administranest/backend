import {
  calculateDepreciation,
  DEFAULT_USEFUL_LIFE_MONTHS,
} from './depreciation';

describe('calculateDepreciation', () => {
  const asOf = new Date('2026-06-15T00:00:00.000Z');

  it('uses the configured useful life in months', () => {
    const result = calculateDepreciation({
      purchaseValue: 1200,
      salvageValue: 0,
      acquisitionDate: new Date('2025-06-15T00:00:00.000Z'),
      usefulLifeMonths: 24,
      asOf,
    });

    expect(result.monthlyDepreciation).toBe(50);
    expect(result.accumulatedDepreciation).toBe(600);
    expect(result.currentValue).toBe(600);
    expect(result.usefulLifeUsedPct).toBe(50);
    expect(result.endOfLife).toBe(false);
  });

  it('defaults to a useful life of 120 months', () => {
    const result = calculateDepreciation({
      purchaseValue: 1200,
      salvageValue: 0,
      acquisitionDate: new Date('2025-06-15T00:00:00.000Z'),
      asOf,
    });

    expect(DEFAULT_USEFUL_LIFE_MONTHS).toBe(120);
    expect(result.monthlyDepreciation).toBe(10);
    expect(result.usefulLifeUsedPct).toBe(10);
  });

  it('keeps the salvage value when the useful life ends', () => {
    const result = calculateDepreciation({
      purchaseValue: 1200,
      salvageValue: 200,
      acquisitionDate: new Date('2025-06-15T00:00:00.000Z'),
      usefulLifeMonths: 10,
      asOf,
    });

    expect(result.monthlyDepreciation).toBe(0);
    expect(result.currentValue).toBe(200);
    expect(result.endOfLife).toBe(true);
  });

  it('reports no monthly depreciation after the useful life ends', () => {
    const result = calculateDepreciation({
      purchaseValue: 1200,
      salvageValue: 200,
      acquisitionDate: new Date('2025-06-15T00:00:00.000Z'),
      usefulLifeMonths: 12,
      asOf,
    });

    expect(result.monthlyDepreciation).toBe(0);
    expect(result.currentValue).toBe(200);
    expect(result.usefulLifeUsedPct).toBe(100);
    expect(result.endOfLife).toBe(true);
  });

  it('does not count elapsed depreciation in the acquisition month', () => {
    const result = calculateDepreciation({
      purchaseValue: 1200,
      salvageValue: 0,
      acquisitionDate: new Date('2026-06-01T00:00:00.000Z'),
      usefulLifeMonths: 12,
      asOf,
    });

    expect(result.accumulatedDepreciation).toBe(0);
    expect(result.currentValue).toBe(1200);
    expect(result.usefulLifeUsedPct).toBe(0);
    expect(result.endOfLife).toBe(false);
  });
});
