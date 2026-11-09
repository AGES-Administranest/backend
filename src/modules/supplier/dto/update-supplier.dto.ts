import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, ValidateIf } from 'class-validator';

import { CreateSupplierDto } from './create-supplier.dto';
import { IsValidTaxIdPair } from '../../../shared/validation/tax-id';

/**
 * Re-declare the tax id so pair validation runs when only taxIdType is sent.
 */
export class UpdateSupplierDto extends PartialType(
  OmitType(CreateSupplierDto, ['taxId'] as const),
) {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '12345678000190',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.replace(/[^0-9a-z]/gi, '').toUpperCase()
      : value,
  )
  @IsValidTaxIdPair()
  taxId?: string | null;

  @ApiPropertyOptional({
    example: true,
    description:
      'true reactivates an inactive supplier; false inactivates it, the same as DELETE',
  })
  @ValidateIf((_dto, value) => value !== undefined)
  @IsBoolean()
  active?: boolean;
}
