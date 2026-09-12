/**
 * Public API of the `stock-movements` module.
 *
 * Other modules import from here (`../stock-movements`), never from inside
 * (`../stock-movements/stock-movements.service`) — the `no-restricted-imports`
 * rule in `eslint.config.mjs` blocks it.
 */
export { StockMovementEntity } from './entities/stock-movement.entity';
export { StockMovementsModule } from './stock-movements.module';
export {
  StockMovementsService,
  type RecordMovementInput,
  type RecordMovementResult,
} from './stock-movements.service';
