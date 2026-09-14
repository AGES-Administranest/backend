/**
 * Public API of the `stock-entry` module.
 *
 * Other modules import from here (`../stock-entry`), never from the inside
 * (`../stock-entry/stock-entry.service`) — the `no-restricted-imports` rule in
 * `eslint.config.mjs` blocks it.
 */
export { StockEntryModule } from './stock-entry.module';
export { StockEntryService } from './stock-entry.service';
