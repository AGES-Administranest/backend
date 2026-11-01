import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaxIdType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { IsValidTaxIdPair } from '../../../shared/validation/tax-id';

export class CreateSupplierDto {
  @ApiProperty({ example: 'Distribuidora VetSul' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '12345678000190',
    description:
      'Digits only: 14 for a CNPJ. Always sent together with taxIdType; both null remove the tax id.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.replace(/[^0-9a-z]/gi, '').toUpperCase()
      : value,
  )
  @IsValidTaxIdPair()
  taxId?: string | null;

  @ApiPropertyOptional({ enum: [TaxIdType.CNPJ], nullable: true })
  @IsOptional()
  @IsEnum(TaxIdType)
  @IsIn([TaxIdType.CNPJ])
  taxIdType?: TaxIdType | null;

  @ApiPropertyOptional({ example: 'Maria (comercial)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  contact?: string;

  @ApiPropertyOptional({ example: 'vendas@vetsul.com.br' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+55 51 99999-0000' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ example: 'Preferir pedidos até o dia 10.' })
  @IsOptional()
  @IsString()
  notes?: string;
}
