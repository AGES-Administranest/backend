import { ApiProperty } from '@nestjs/swagger';

import { StockHistoryEntryEntity } from './stock-history-entry.entity';
import { StockHistoryRow } from '../stock-history.repository';

/** One page of the history plus what the app needs to page through it. */
export class StockHistoryPageEntity {
  @ApiProperty({ type: [StockHistoryEntryEntity] })
  data!: StockHistoryEntryEntity[];

  /** 1-based */
  page!: number;

  limit!: number;

  /** rows matching the filter across every page */
  total!: number;

  static from(
    rows: StockHistoryRow[],
    page: number,
    limit: number,
    total: number,
  ): StockHistoryPageEntity {
    return {
      data: rows.map(row => StockHistoryEntryEntity.fromRow(row)),
      page,
      limit,
      total,
    };
  }
}
