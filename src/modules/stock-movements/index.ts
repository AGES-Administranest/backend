/**
 * Public API of the `stock-movements` module.
 *
 * Other modules import from here (`../stock-movements`), never from inside
 * (`../stock-movements/stock-history.service`) — the `no-restricted-imports`
 * rule in `eslint.config.mjs` blocks it.
 */
export { StockHistoryEntryEntity } from './entities/stock-history-entry.entity';
export { StockHistoryPageEntity } from './entities/stock-history-page.entity';
export { StockSummaryEntity } from './entities/stock-summary.entity';
export { StockHistoryService } from './stock-history.service';
export { StockMovementsModule } from './stock-movements.module';
