import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ItemCategory } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export const ITEM_SORT_FIELDS = [
  'name',
  'currentQuantity',
  'updatedAt',
] as const;
export type ItemSortField = (typeof ITEM_SORT_FIELDS)[number];

const toArray = ({ value }: { value: unknown }): unknown[] | undefined =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

export class QueryItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId!: string;

  @ApiPropertyOptional({
    description:
      'Partial, case-insensitive match on the item name. Ignored when shorter than 2 characters.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: ItemCategory,
    isArray: true,
    description: 'Accepts multiple values; absent means every category',
  })
  @IsOptional()
  @Transform(toArray)
  @IsEnum(ItemCategory, { each: true })
  category?: ItemCategory[];

  @ApiPropertyOptional({
    default: true,
    description:
      'Inactive items are only returned when explicitly set to false',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'false' ? false : value === 'true' ? true : value,
  )
  @IsBoolean()
  active: boolean = true;

  @ApiPropertyOptional({ enum: ITEM_SORT_FIELDS, default: 'name' })
  @IsOptional()
  @IsIn(ITEM_SORT_FIELDS)
  sort: ItemSortField = 'name';

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
