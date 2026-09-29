/**
 * Public API of the `stock-movements` module.
 *
 * Other modules import from here (`../stock-movements`), never from inside —
 * the `no-restricted-imports` rule in `eslint.config.mjs` blocks it.
 *
 * `StockMovementsService` is the whole write surface on purpose: every stock
 * flow goes through `record`/`recordBatch` and nothing else, and the repository
 * is deliberately not exported (ADR-10).
 */
export { StockMovementResultEntity } from './entities/stock-movement-result.entity';
export { StockMovementEntity } from './entities/stock-movement.entity';
export { StockSummaryEntity } from './entities/stock-summary.entity';
export {
  StockSyncPullEntity,
  StockSyncPushEntity,
} from './entities/stock-sync.entity';
export { StockMovementsModule } from './stock-movements.module';
export {
  StockMovementsService,
  type RecordMovementInput,
  type RecordMovementResult,
  type RecordOptions,
} from './stock-movements.service';
