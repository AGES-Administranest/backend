import { ApiProperty } from '@nestjs/swagger';

import { EXPENSE_GROUPS, type ExpenseGroup } from '../expense-groups';

export class ExpenseByCategoryItem {
  @ApiProperty({ enum: EXPENSE_GROUPS, example: 'SUPPLIES' })
  category!: ExpenseGroup;

  @ApiProperty({ type: String, example: '120.50' })
  subtotal!: string;
}

export class ExpensesByCategoryResponse {
  @ApiProperty({ type: ExpenseByCategoryItem, isArray: true })
  items!: ExpenseByCategoryItem[];

  @ApiProperty({ type: String, example: '800.00' })
  total!: string;
}

export class FinancialBalanceResponse {
  @ApiProperty({ type: String, example: '2500.00' })
  totalIncome!: string;

  @ApiProperty({ type: String, example: '800.00' })
  totalExpenses!: string;

  @ApiProperty({ type: String, example: '500.00' })
  professionalExpenses!: string;

  @ApiProperty({ type: String, example: '300.00' })
  personalExpenses!: string;

  @ApiProperty({ type: String, example: '1700.00' })
  netBalance!: string;

  @ApiProperty({ type: ExpensesByCategoryResponse })
  expensesByCategory!: ExpensesByCategoryResponse;
}
