import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AdjustmentReason,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { toEnumValue } from './create-stock-adjustment.dto';

/** Big enough for weeks offline, small enough not to hold the item rows locked. */
export const SYNC_PUSH_MAX_BATCH = 200;

/**
 * One movement as a device recorded it offline. Unlike every other write here,
 * the client decides `id`, `occurredAt` and `unitCost` — none existed on the
 * server when it happened. The `id` (ADR-09) is what makes a resend safe.
 */
export class SyncStockMovementDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'UUID generated on the device (ADR-09). Re-sending an id the ledger ' +
      'already holds is reported back, never applied twice.',
  })
  @IsUUID()
  id!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  itemId!: string;

  @ApiProperty({ enum: StockMovementType })
  @Transform(toEnumValue)
  @IsEnum(StockMovementType)
  type!: StockMovementType;

  @ApiProperty({
    enum: StockMovementSource,
    description:
      'ORDER_IMPORT is not accepted here: importing an order needs the network ' +
      'anyway (US10), so it can never be something a device recorded offline.',
  })
  @Transform(toEnumValue)
  @IsEnum(StockMovementSource)
  source!: StockMovementSource;

  @ApiProperty({
    description: 'Positive magnitude — the sign comes from `type`',
  })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;

  @ApiProperty({ description: 'Unit cost as the device knew it at the time' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  unitCost!: number;

  @ApiProperty({
    format: 'date-time',
    description:
      'When it happened on the device. Drives the order the batch is applied ' +
      'in — arrival order is ignored.',
  })
  @IsISO8601()
  occurredAt!: string;

  @ApiPropertyOptional({ enum: AdjustmentReason, nullable: true })
  @IsOptional()
  @Transform(toEnumValue)
  @IsEnum(AdjustmentReason)
  adjustmentReason?: AdjustmentReason | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  appointmentId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  supplierId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  lotId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

// No `userId`: the owner comes from the token, never from the payload (ADR-11).
export class SyncStockMovementsDto {
  @ApiProperty({
    type: SyncStockMovementDto,
    isArray: true,
    maxItems: SYNC_PUSH_MAX_BATCH,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(SYNC_PUSH_MAX_BATCH)
  @ValidateNested({ each: true })
  @Type(() => SyncStockMovementDto)
  movements!: SyncStockMovementDto[];
}

/** Query for the delta pull. */
export class QueryStockSyncDto {
  @ApiProperty({
    format: 'date-time',
    description:
      "The cursor from the device's last successful pull. A device syncing for " +
      'the first time sends an old date; the answer is capped and carries the ' +
      'cursor to continue from.',
    example: '2026-09-20T12:00:00.000Z',
  })
  @IsISO8601()
  since!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The `afterId` of the previous page, sent back while `hasMore` is true. ' +
      'The page then continues right after that movement, with no overlap, ' +
      'so a burst of rows sharing one timestamp cannot pin the pull in place.',
  })
  @IsOptional()
  @IsUUID()
  afterId?: string;
}
