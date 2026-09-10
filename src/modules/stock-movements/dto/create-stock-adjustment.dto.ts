import { AdjustmentReason } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';

/**
 * Input for `POST /stock-movements/adjustments` (US11).
 *
 * The direction is fixed — a manual adjustment here is always an outbound loss.
 * `notes` is only required when the reason is `OTHER`: without it the history
 * cannot say what the "other" was.
 */
export class CreateStockAdjustmentDto {
  @IsUUID()
  itemId!: string;

  /** Positive magnitude to remove from the balance. */
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;

  @IsEnum(AdjustmentReason)
  adjustmentReason!: AdjustmentReason;

  /** When the loss happened. */
  @IsDateString()
  date!: string;

  @ValidateIf(
    (dto: CreateStockAdjustmentDto) =>
      dto.adjustmentReason === AdjustmentReason.OTHER,
  )
  @IsString()
  @IsNotEmpty()
  notes?: string;
}
