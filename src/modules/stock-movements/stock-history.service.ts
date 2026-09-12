import { Injectable } from '@nestjs/common';

import {
  type PeriodBalance,
  type SummarizableMovement,
  balanceFromSums,
  periodBalance,
  summarizePeriod,
} from './domain/stock-summary.rules';
import { QueryStockHistoryDto } from './dto/query-stock-history.dto';
import { StockHistoryPageEntity } from './entities/stock-history-page.entity';
import { StockSummaryEntity } from './entities/stock-summary.entity';
import {
  StockHistoryFilter,
  StockHistoryRepository,
  StockSummaryRow,
} from './stock-history.repository';
import type { AuthenticatedUser } from '../../shared/auth';
import { DomainError } from '../../shared/errors/domain-error';
import {
  toPeriodEnd,
  toPeriodStart,
} from '../../shared/validation/period-bounds';
import { UsersService } from '../users';

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
  ): Promise<StockHistoryPageEntity> {
    const userId = await this.resolveUserId(authUser);
    const filter = await this.toFilter(userId, query);
    const pageRequest = { page: query.page, limit: query.limit };

    const [rows, total] = await Promise.all([
      this.repository.findPage(userId, filter, pageRequest),
      this.repository.count(userId, filter),
    ]);

    return StockHistoryPageEntity.from(rows, query.page, query.limit, total);
  }

  async summarize(
    authUser: AuthenticatedUser,
    query: Partial<QueryStockHistoryDto>,
  ): Promise<StockSummaryEntity> {
    const userId = await this.resolveUserId(authUser);
    const filter = await this.toFilter(userId, query);
    const rows = await this.repository.findForSummary(userId, filter);

    const summary = summarizePeriod(rows.map(toSummarizable));
    const item = filter.itemId
      ? await this.itemBalance(userId, filter.itemId, filter.from, rows)
      : null;

    return StockSummaryEntity.from(summary, item);
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
