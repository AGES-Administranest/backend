import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

/**
 * Input for `POST /stock-movements/purchases` (manual purchase entry).
 *
 * For purchases with no order/invoice to import (over-the-counter, a supplier
 * that issues no PDF). The direction is fixed — a manual purchase is always an
 * inbound.
 */
export class CreateStockPurchaseDto {
  @IsUUID()
  itemId!: string;

  /** Positive magnitude to add to the balance. */
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;

  /** Unit price paid. Becomes the item's current unit cost. */
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  unitValue!: number;

  /** Optional supplier — validated against the user's own suppliers (US33). */
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  /** When the purchase happened. May be backdated; a future date is rejected. */
  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
