import { Prisma } from '@prisma/client';

import {
  calculateHourlyRate,
  formatHourlyRateValue,
  HourlyRateInput,
  percentagesOf,
  productiveHoursPerMonth,
} from './hourly-rate';

const dec = (value: string) => new Prisma.Decimal(value);
const strings = (values: Prisma.Decimal[]) =>
  values.map(value => value.toFixed(2));
const sum = (values: Prisma.Decimal[]) =>
  values.reduce((total, value) => total.plus(value), dec('0'));

/** October in the US20 prototype. */
const october: HourlyRateInput = {
  fixedCosts: '1399.08',
  variableCosts: '1225.00',
  ownerDraw: '8000.00',
  safetyMarginPct: '20',
  weeklyHours: '30',
};

describe('productiveHoursPerMonth', () => {
  it.each([
    ['30', '130'],
    ['37.5', '162.5'],
    ['40', '173.33'],
    ['168', '728'],
  ])('%s hours a week give %s hours a month', (weekly, expected) => {
    expect(productiveHoursPerMonth(weekly).toDecimalPlaces(2).toString()).toBe(
      expected,
    );
  });
});

describe('percentagesOf', () => {
  it('adds up to exactly 100 when rounding each share would not', () => {
    // three equal thirds: 33.33 × 3 = 99.99 if each one is rounded alone
    const shares = percentagesOf([dec('1'), dec('1'), dec('1')]);

    expect(strings(shares)).toEqual(['33.34', '33.33', '33.33']);
    expect(sum(shares).toFixed(2)).toBe('100.00');
  });

  it('gives the leftover hundredth to the largest remainder', () => {
    // exact shares: 33.333… and 66.666… → floors add up to 99.99, and the
    // hundredth left goes to the second one, whose remainder is larger
    const shares = percentagesOf([dec('1'), dec('2')]);

    expect(strings(shares)).toEqual(['33.33', '66.67']);
  });

  it('breaks a tie in the remainders in favour of the earlier part', () => {
    const shares = percentagesOf([dec('1'), dec('1'), dec('4')]);

    expect(strings(shares)).toEqual(['16.67', '16.67', '66.66']);
    expect(sum(shares).toFixed(2)).toBe('100.00');
  });

  it('answers zeros when there is nothing to share', () => {
    expect(strings(percentagesOf([dec('0'), dec('0')]))).toEqual([
      '0.00',
      '0.00',
    ]);
  });
});

describe('calculateHourlyRate', () => {
  it('reproduces the October numbers of the prototype', () => {
    const result = calculateHourlyRate(october);

    expect(
      result.parts.map(part => [
        part.key,
        part.amount.toFixed(2),
        part.percentOfTotal.toFixed(2),
      ]),
    ).toEqual([
      ['FIXED_COSTS', '1399.08', '10.97'],
      ['VARIABLE_COSTS', '1225.00', '9.61'],
      ['OWNER_DRAW', '8000.00', '62.75'],
      // 20% of 10624.08 = 2124.816
      ['SAFETY_MARGIN', '2124.82', '16.67'],
    ]);
    expect(result.total.toFixed(2)).toBe('12748.90');
    expect(result.productiveHours.toFixed(2)).toBe('130.00');
    expect(result.hourlyRate.toFixed(2)).toBe('98.07');
    expect(result.minimumHourlyRate.toFixed(2)).toBe('81.72');
  });

  it('makes the parts add up to the total and the shares to 100', () => {
    const result = calculateHourlyRate({
      ...october,
      safetyMarginPct: '13.37',
    });

    expect(
      sum(result.parts.map(part => part.amount)).equals(result.total),
    ).toBe(true);
    expect(sum(result.parts.map(part => part.percentOfTotal)).toFixed(2)).toBe(
      '100.00',
    );
  });

  it('charges only the owner draw in a month without costs', () => {
    const result = calculateHourlyRate({
      fixedCosts: '0',
      variableCosts: '0',
      ownerDraw: '8000',
      safetyMarginPct: '20',
      weeklyHours: '40',
    });

    expect(strings(result.parts.map(part => part.amount))).toEqual([
      '0.00',
      '0.00',
      '8000.00',
      '1600.00',
    ]);
    expect(strings(result.parts.map(part => part.percentOfTotal))).toEqual([
      '0.00',
      '0.00',
      '83.33',
      '16.67',
    ]);
    // 9600 ÷ 173.333… = 55.384…
    expect(result.hourlyRate.toFixed(2)).toBe('55.38');
    expect(result.minimumHourlyRate.toFixed(2)).toBe('46.15');
  });

  it('makes the hourly rate equal to the minimum with a 0% margin', () => {
    const result = calculateHourlyRate({ ...october, safetyMarginPct: '0' });

    expect(result.parts[3].amount.toFixed(2)).toBe('0.00');
    expect(result.parts[3].percentOfTotal.toFixed(2)).toBe('0.00');
    expect(result.hourlyRate.equals(result.minimumHourlyRate)).toBe(true);
  });

  it('divides by the full productive hours, not by the rounded ones', () => {
    // 40 h/week = 173.333… h. 100000 ÷ 173.333… = 576.923…, while dividing by
    // the displayed 173.33 would give 576.934… and answer one cent more.
    const result = calculateHourlyRate({
      fixedCosts: '0',
      variableCosts: '0',
      ownerDraw: '100000',
      safetyMarginPct: '0',
      weeklyHours: '40',
    });

    expect(result.productiveHours.toFixed(2)).toBe('173.33');
    expect(result.hourlyRate.toFixed(2)).toBe('576.92');
  });

  it('accepts the Decimal values Prisma hands back', () => {
    const result = calculateHourlyRate({
      fixedCosts: dec('1399.08'),
      variableCosts: dec('1225'),
      ownerDraw: dec('8000.00'),
      safetyMarginPct: dec('20.00'),
      weeklyHours: dec('30.00'),
    });

    expect(result.hourlyRate.toFixed(2)).toBe('98.07');
  });

  it.each(['0', '-1'])('refuses %s weekly hours', weeklyHours => {
    expect(() => calculateHourlyRate({ ...october, weeklyHours })).toThrow(
      RangeError,
    );
  });

  it.each(['-0.01', '100.01'])('refuses a %s%% margin', safetyMarginPct => {
    expect(() => calculateHourlyRate({ ...october, safetyMarginPct })).toThrow(
      RangeError,
    );
  });
});

describe('formatHourlyRateValue', () => {
  it('returns 2 places, half up', () => {
    expect(formatHourlyRateValue('98.065')).toBe('98.07');
    expect(formatHourlyRateValue(130)).toBe('130.00');
  });
});
