/**
 * Public API of the `stock-movements` module.
 *
 * Other modules import from here (`../stock-movements`), never from inside
 * (`../stock-movements/stock-movements.service`) — the `no-restricted-imports`
 * rule in `eslint.config.mjs` blocks it.
 *
 * `StockMovementsService` is the whole surface on purpose: US06, US10 and US11
 * write stock through `record`/`recordBatch` and nothing else. The repository
 * is deliberately not exported (ADR-10).
 */
export { StockBalanceReconciliationEntity } from './entities/stock-balance-reconciliation.entity';
export { StockMovementResultEntity } from './entities/stock-movement-result.entity';
export {
  StockSyncPullEntity,
  StockSyncPushEntity,
  SyncedItemBalanceEntity,
} from './entities/stock-sync.entity';
export {
  MovementAppointmentEntity,
  StockMovementEntity,
} from './entities/stock-movement.entity';
export { StockMovementsModule } from './stock-movements.module';
export {
  StockMovementsService,
  type RecordMovementInput,
  type RecordMovementResult,
  type RecordOptions,
  type SyncMovementInput,
  type LotResolver,
} from './stock-movements.service';
