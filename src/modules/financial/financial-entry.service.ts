import { Injectable } from '@nestjs/common';

import { QueryFinancialEntryDto } from './dto/query-financial-entry.dto';
import { FinancialEntryResponse } from './entities/financial-entry.entity';
import {
  FinancialEntryRepository,
  StatementRow,
} from './financial-entry.repository';

export function accrualMonth(year?: number, month?: number, now = new Date()) {
  const y = year ?? now.getUTCFullYear();
  const m = month ?? now.getUTCMonth() + 1;
  return {
    from: new Date(Date.UTC(y, m - 1, 1)),
    to: new Date(Date.UTC(y, m, 1)),
  };
}

export function toStatementEntry(row: StatementRow): FinancialEntryResponse {
  const id =
    row.appointmentId ??
    row.serviceInvoiceId ??
    row.purchaseInvoiceId ??
    row.tripId ??
    null;
  return {
    id: row.id,
    nature: row.nature,
    description: row.description,
    category: row.category,
    scope: row.scope,
    amount: row.amount,
    accrualDate: row.accrualDate,
    source: row.source,
    origin: { type: row.source, id },
  };
}

@Injectable()
export class FinancialEntryService {
  constructor(private readonly repository: FinancialEntryRepository) {}

  async findAll(
    userId: string,
    query: QueryFinancialEntryDto,
  ): Promise<FinancialEntryResponse[]> {
    const { from, to } = accrualMonth(query.year, query.month);
    const rows = await this.repository.findStatement(
      userId,
      {
        from,
        to,
        nature: query.nature,
        scope: query.scope,
        categoryId: query.categoryId,
      },
      (query.page - 1) * query.limit,
      query.limit,
    );
    return rows.map(toStatementEntry);
  }
}
