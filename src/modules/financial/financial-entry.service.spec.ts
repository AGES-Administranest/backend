import { EntryNature, EntryScope, EntrySource, Prisma } from '@prisma/client';

import { QueryFinancialEntryDto } from './dto/query-financial-entry.dto';
import { StatementRow } from './financial-entry.repository';
import {
  FinancialEntryService,
  toStatementEntry,
} from './financial-entry.service';

const row = (overrides: Partial<StatementRow> = {}): StatementRow => ({
  id: 'entry-1',
  nature: EntryNature.INCOME,
  description: 'Procedure',
  scope: EntryScope.PROFESSIONAL,
  amount: new Prisma.Decimal('10.00'),
  accrualDate: new Date('2026-03-15T12:00:00.000Z'),
  source: EntrySource.MANUAL,
  appointmentId: null,
  serviceInvoiceId: null,
  purchaseInvoiceId: null,
  tripId: null,
  category: {
    id: 'cat-1',
    name: 'Professional fees',
    defaultScope: EntryScope.PROFESSIONAL,
  },
  ...overrides,
});

describe('FinancialEntryService', () => {
  let repository: { findStatement: jest.Mock };
  let service: FinancialEntryService;

  beforeEach(() => {
    repository = { findStatement: jest.fn().mockResolvedValue([]) };
    service = new FinancialEntryService(repository as never);
  });

  it('uses the current UTC month when month and year are absent', async () => {
    const query = new QueryFinancialEntryDto();
    await service.findAll('user-1', query);

    const now = new Date();
    expect(repository.findStatement).toHaveBeenCalledWith(
      'user-1',
      {
        from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
        nature: undefined,
        scope: undefined,
        categoryId: undefined,
      },
      0,
      50,
    );
  });

  it('combines month, nature, scope and category and pages forward', async () => {
    const query = Object.assign(new QueryFinancialEntryDto(), {
      month: 3,
      year: 2026,
      nature: EntryNature.EXPENSE,
      scope: EntryScope.PERSONAL,
      categoryId: 'cat-9',
      page: 2,
      limit: 20,
    });

    await service.findAll('user-1', query);

    expect(repository.findStatement).toHaveBeenCalledWith(
      'user-1',
      {
        from: new Date(Date.UTC(2026, 2, 1)),
        to: new Date(Date.UTC(2026, 3, 1)),
        nature: EntryNature.EXPENSE,
        scope: EntryScope.PERSONAL,
        categoryId: 'cat-9',
      },
      20,
      20,
    );
  });

  it('returns the filled origin id and nothing for a manual entry', () => {
    expect(toStatementEntry(row()).origin).toEqual({
      type: EntrySource.MANUAL,
      id: null,
    });
    expect(
      toStatementEntry(
        row({
          source: EntrySource.APPOINTMENT,
          appointmentId: 'appt-1',
        }),
      ).origin,
    ).toEqual({ type: EntrySource.APPOINTMENT, id: 'appt-1' });
  });
});
