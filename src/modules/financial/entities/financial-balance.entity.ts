import { ApiProperty } from '@nestjs/swagger';

import { EXPENSE_GROUPS, type ExpenseGroup } from '../expense-groups';

export class ExpenseByCategoryResponse {
  @ApiProperty({ enum: EXPENSE_GROUPS, example: 'SUPPLIES' })
  category!: ExpenseGroup;

  @ApiProperty({ type: String, example: '120.50' })
  subtotal!: string;
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

  @ApiProperty({ type: ExpenseByCategoryResponse, isArray: true })
  expensesByCategory!: ExpenseByCategoryResponse[];
}
