import { checkLine } from '../../../../src/modules/extraction/domain/arithmetic';

describe('checkLine', () => {
  it.each([
    ['an exact line', 5, 18.9, 94.5],
    ['float noise', 12, 8.4, 100.8],
    ['a one-cent rounding', 3, 0.33, 1],
    ['a unit price rounded to the cent over many units', 100, 0.333, 33.3],
  ])('accepts %s', (_, quantity, unitValue, totalValue) => {
    expect(checkLine(quantity, unitValue, totalValue)).toBe(true);
  });

  it('refuses a line whose numbers do not close', () => {
    // The review screen's divergence example: 12 × 8,40 is 100,80, not 118,00.
    expect(checkLine(12, 8.4, 118)).toBe(false);
  });

  it('refuses a drift larger than half a cent per unit', () => {
    expect(checkLine(2, 10, 20.05)).toBe(false);
  });

  it.each([
    ['quantity', undefined, 18.9, 94.5],
    ['unit value', 5, undefined, 94.5],
    ['total', 5, 18.9, undefined],
  ])('does not vouch for a line missing its %s', (_, q, u, t) => {
    expect(checkLine(q, u, t)).toBe(false);
  });
});
