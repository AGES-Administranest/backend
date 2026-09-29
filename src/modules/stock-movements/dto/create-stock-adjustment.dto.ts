import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdjustmentReason } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Accepts an enum in the client's spelling. The API answers in the Prisma one
 * (`MANUAL_ADJUSTMENT`); on the way in it also takes the app's camelCase.
 */
export const toEnumValue = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string'
    ? value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()
    : value;

/**
 * Input for `POST /stock-movement/adjustment` (US11). Direction, origin, cost
 * and timestamp are the server's to decide, not the client's.
 */
export class CreateStockAdjustmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  itemId!: string;

  @ApiProperty({
    description: 'Positive amount to take out of the balance',
    example: 2,
  })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;

  @ApiProperty({
    enum: AdjustmentReason,
    description: 'Why the stock was lost. Accepted in either case.',
  })
  @Transform(toEnumValue)
  @IsEnum(AdjustmentReason)
  reason!: AdjustmentReason;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Free text. Required when reason is OTHER — that requirement is a domain ' +
      'rule (it holds for every caller of the ledger, not just this route), so a ' +
      'missing one comes back as STOCK_REASON_ADJUSTMENT_INVALID, not as a ' +
      'field validation error.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}
