import { expenseGroupOf } from '../../../src/modules/financial/expense-groups';

describe('expenseGroupOf', () => {
  it.each([
    ['Supplies', 'SUPPLIES'],
    ['Travel', 'TRAVEL'],
    ['Fixed costs', 'FIXED_COSTS'],
    ['Taxes and fees', 'TAXES_AND_FEES'],
    ['Other', 'OTHER'],
  ] as const)('maps %s to %s', (name, group) => {
    expect(expenseGroupOf(name)).toBe(group);
  });

  it('maps an unknown category to OTHER', () => {
    expect(expenseGroupOf('Custom')).toBe('OTHER');
  });
});
