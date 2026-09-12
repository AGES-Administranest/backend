import { Injectable } from '@nestjs/common';

import {
  type PeriodBalance,
  type PeriodSummary,
  type SummarizableMovement,
  balanceFromSums,
  periodBalance,
  summarizePeriod,
} from './domain/stock-summary.rules';
import { QueryStockHistoryDto } from './dto/query-stock-history.dto';
import {
  StockHistoryFilter,
  StockHistoryRepository,
  StockHistoryRow,
  StockSummaryRow,
} from './stock-history.repository';
import type { AuthenticatedUser } from '../../shared/auth';
import { DomainError } from '../../shared/errors/domain-error';
import { UsersService } from '../users';

export interface StockHistoryPage {
  data: StockHistoryRow[];
  page: number;
  limit: number;
  total: number;
}

export interface StockPeriodReport {
  summary: PeriodSummary;
  /** only when the query named an item */
  item: PeriodBalance | null;
}

/** `YYYY-MM-DD`, with no time part. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read side of the stock ledger for US12: the paginated history with its
 * origins resolved, and the consolidated summary of a period. Knows nothing
 * about HTTP; failures are `DomainError` (ADR-07). Every query is scoped by
 * the user resolved from the token, never from the request (ADR-11).
 */
@Injectable()
export class StockHistoryService {
  constructor(
    private readonly repository: StockHistoryRepository,
    private readonly usersService: UsersService,
  ) {}

  async listHistory(
    authUser: AuthenticatedUser,
    query: QueryStockHistoryDto,
  ): Promise<StockHistoryPage> {
    const userId = await this.resolveUserId(authUser);
    const filter = await this.toFilter(userId, query);
    const pageRequest = { page: query.page, limit: query.limit };

    const [data, total] = await Promise.all([
      this.repository.findPage(userId, filter, pageRequest),
      this.repository.count(userId, filter),
    ]);

    return { data, page: query.page, limit: query.limit, total };
  }

  async summarize(
    authUser: AuthenticatedUser,
    query: Partial<QueryStockHistoryDto>,
  ): Promise<StockPeriodReport> {
    const userId = await this.resolveUserId(authUser);
    const filter = await this.toFilter(userId, query);
    const rows = await this.repository.findForSummary(userId, filter);

    const summary = summarizePeriod(rows.map(toSummarizable));
    const item = filter.itemId
      ? await this.itemBalance(userId, filter.itemId, filter.from, rows)
      : null;

    return { summary, item };
  }

  /**
   * Opening balance from the ledger before the period, then the period on top
   * of it. Without a start date the period begins with the ledger itself, so
   * nothing came before it and the opening balance is zero.
   */
  private async itemBalance(
    userId: string,
    itemId: string,
    from: Date | undefined,
    rows: StockSummaryRow[],
  ): Promise<PeriodBalance> {
    if (!from) return periodBalance(0, rows);

    const sums = await this.repository.sumQuantityByTypeBefore(
      userId,
      itemId,
      from,
    );
    return periodBalance(balanceFromSums(sums.inbound, sums.outbound), rows);
  }

  /**
   * The token only carries the Cognito `sub`; the ledger is scoped by the
   * local `user.id`. `users` owns that table, so the translation goes through
   * its service (ADR-01) — it answers `USER_NOT_PROVISIONED` on a missing mirror.
   */
  private async resolveUserId(authUser: AuthenticatedUser): Promise<string> {
    const user = await this.usersService.findByCognitoSub(authUser.cognitoSub);
    return user.id;
  }

  /**
   * Query string → repository filter. An item that is not the user's answers
   * 404, not 403: confirming it exists would already leak it.
   */
  private async toFilter(
    userId: string,
    query: Partial<QueryStockHistoryDto>,
  ): Promise<StockHistoryFilter> {
    if (query.itemId) {
      const item = await this.repository.findItemById(userId, query.itemId);
      if (!item) throw this.itemNotFound(query.itemId);
    }

    return {
      ...(query.itemId && { itemId: query.itemId }),
      ...(query.startDate && { from: toPeriodStart(query.startDate) }),
      ...(query.endDate && { to: toPeriodEnd(query.endDate) }),
      ...(query.type && { type: query.type }),
      ...(query.source && { source: query.source }),
    };
  }

  private itemNotFound(itemId: string): DomainError {
    return new DomainError(
      'NOT_FOUND',
      'ITEM_NOT_FOUND',
      `Item ${itemId} not found`,
      { itemId },
    );
  }
}

/** A date-only start is the first instant of that day (UTC). */
function toPeriodStart(value: string): Date {
  return new Date(value);
}

/**
 * A date-only end covers the whole day: `2026-09-30` means up to
 * `23:59:59.999Z`, not midnight at its start. A full timestamp is used as is.
 */
function toPeriodEnd(value: string): Date {
  return DATE_ONLY.test(value)
    ? new Date(`${value}T23:59:59.999Z`)
    : new Date(value);
}

/** The summary rules want the procedure name flat, not nested in the appointment. */
function toSummarizable(row: StockSummaryRow): SummarizableMovement {
  return {
    type: row.type,
    source: row.source,
    adjustmentReason: row.adjustmentReason,
    quantity: row.quantity,
    unitCost: row.unitCost,
    deletedAt: row.deletedAt,
    procedureName: row.appointment?.procedureName ?? null,
  };
}
