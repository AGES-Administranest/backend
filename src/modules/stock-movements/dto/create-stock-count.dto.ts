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
 * Input for `POST /stock-movement/count` — the way out of `needsAdjustment`
 * (US10). The difference between the count and the balance is written as one
 * more movement, never as an edit.
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
