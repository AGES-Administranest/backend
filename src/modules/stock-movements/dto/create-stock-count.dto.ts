import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Input for `POST /stock-movement/count` — the physical count that reconciles
 * an item whose balance drifted from reality.
 *
 * This is the way out of `needsAdjustment` (US10). A correction reversal can
 * drive the balance below zero, which is the ledger saying "the inventory was
 * wrong", and no outbound can fix that: the only honest answer is the number
 * the user counted on the shelf. The ledger stays append-only — the difference
 * between the counted amount and the current balance is written as one more
 * movement, never as an edit.
 */
export class CreateStockCountDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  itemId!: string;

  @ApiProperty({
    description: 'The amount actually on the shelf. Zero is a valid count.',
    example: 4,
  })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  countedQuantity!: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}
