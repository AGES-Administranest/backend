export const EXPENSE_GROUPS = [
  'SUPPLIES',
  'TRAVEL',
  'FIXED_COSTS',
  'TAXES_AND_FEES',
  'OTHER',
] as const;

export type ExpenseGroup = (typeof EXPENSE_GROUPS)[number];

const EXPENSE_GROUP_BY_CATEGORY_NAME: Record<string, ExpenseGroup> = {
  Supplies: 'SUPPLIES',
  Travel: 'TRAVEL',
  'Fixed costs': 'FIXED_COSTS',
  'Taxes and fees': 'TAXES_AND_FEES',
  Other: 'OTHER',
};

export function expenseGroupOf(categoryName: string): ExpenseGroup {
  return EXPENSE_GROUP_BY_CATEGORY_NAME[categoryName] ?? 'OTHER';
}
