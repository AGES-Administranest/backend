import { FinancialBalanceController } from '../../../src/modules/financial/financial-balance.controller';
import { FinancialCategoryController } from '../../../src/modules/financial/financial-category.controller';
import { FinancialCategoryService } from '../../../src/modules/financial/financial-category.service';
import { FinancialEntryController } from '../../../src/modules/financial/financial-entry.controller';
import { FinancialEntryService } from '../../../src/modules/financial/financial-entry.service';
import { describeRoutes, ID, OTHER_ID, USER } from '../testing/routes';

const entry = {
  id: OTHER_ID,
  nature: 'EXPENSE',
  description: 'Rent',
  amount: 100,
  accrualDate: '2026-10-01',
  categoryId: OTHER_ID,
};
const category = {
  id: OTHER_ID,
  name: 'Courses',
  nature: 'EXPENSE',
  defaultScope: 'PERSONAL',
};
const operations = [
  { id: OTHER_ID, operation: 'delete', occurredAt: '2026-10-01T10:00:00.000Z' },
];

describeRoutes('financial', {
  controllers: [
    FinancialEntryController,
    FinancialCategoryController,
    FinancialBalanceController,
  ],
  services: [FinancialEntryService, FinancialCategoryService],
  routes: [
    {
      route: 'GET /financial-entries?month=10&year=2026&nature=EXPENSE',
      calls: [
        FinancialEntryService,
        'findAll',
        USER.id,
        { month: 10, year: 2026, nature: 'EXPENSE', page: 1, limit: 50 },
      ],
    },
    {
      route: 'POST /financial-entries/sync',
      body: operations,
      status: 201,
      calls: [FinancialEntryService, 'sync', USER.id, operations],
    },
    {
      route: 'POST /financial-entries',
      body: entry,
      status: 201,
      calls: [FinancialEntryService, 'create', USER.id, entry],
    },
    {
      route: `GET /financial-entries/${ID}`,
      calls: [FinancialEntryService, 'findOne', USER.id, ID],
    },
    {
      route: `PATCH /financial-entries/${ID}`,
      body: { description: 'Office rent' },
      calls: [
        FinancialEntryService,
        'update',
        USER.id,
        ID,
        { description: 'Office rent' },
      ],
    },
    {
      route: `DELETE /financial-entries/${ID}`,
      status: 204,
      calls: [FinancialEntryService, 'remove', USER.id, ID],
    },
    {
      route: 'GET /financial-categories?nature=INCOME',
      calls: [
        FinancialCategoryService,
        'findAll',
        USER.id,
        { nature: 'INCOME' },
      ],
    },
    {
      route: 'POST /financial-categories',
      body: category,
      status: 201,
      calls: [FinancialCategoryService, 'create', USER.id, category],
    },
    {
      route: 'GET /financial-balance?month=10&year=2026',
      calls: [
        FinancialEntryService,
        'getBalance',
        USER.id,
        { month: 10, year: 2026 },
      ],
    },
  ],
});
