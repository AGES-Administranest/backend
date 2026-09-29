import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { MAX_DRAFT_AMOUNT, MAX_DRAFT_LINES } from '../stock-entry.constants';

/** Values stay optional in a draft: the confirmation is what requires them. */
export class DraftLineInputDto {
  @ApiPropertyOptional({
    example: 0,
    description:
      'The document line it came from; absent on a line added by hand',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sourceIndex?: number;

  @ApiProperty({ example: 'PROPOFOL 1% 20ML AMP' })
  @IsString()
  @MaxLength(500)
  description!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_DRAFT_AMOUNT)
  quantity?: number;

  @ApiPropertyOptional({ example: 18.9 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_DRAFT_AMOUNT)
  unitCost?: number;

  @ApiPropertyOptional({
    example: 94.5,
    description: 'The printed total, while it disagrees with the line',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_DRAFT_AMOUNT)
  totalValue?: number;

  @ApiPropertyOptional({ example: 'PF8821' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  lotNumber?: string;

  @ApiPropertyOptional({ example: '2027-05-31', format: 'date' })
  @IsOptional()
  @IsDateString()
  expirationDate?: string;
}

export class ReplaceDraftLinesDto {
  @ApiProperty({ type: [DraftLineInputDto] })
  @IsArray()
  @ArrayMaxSize(MAX_DRAFT_LINES)
  @ValidateNested({ each: true })
  @Type(() => DraftLineInputDto)
  lines!: DraftLineInputDto[];
}
