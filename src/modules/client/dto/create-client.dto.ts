import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClientType, PaymentMethod, TaxIdType, Weekday } from '@prisma/client';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { IsValidTaxIdPair } from '../../../shared/validation/tax-id';

/** Also used by UpdateClientDto, which has to declare `taxId` again. */
export const TaxIdProperty = () =>
  applyDecorators(
    ApiPropertyOptional({
      type: String,
      nullable: true,
      example: '12345678000190',
      description:
        'Digits only: 11 for a CPF, 14 for a CNPJ. Always sent together ' +
        'with taxIdType; both null remove the tax id.',
    }),
    IsValidTaxIdPair(),
  );

export class CreateClientDto {
  @ApiProperty({ enum: ClientType, example: ClientType.CLINIC })
  @IsEnum(ClientType)
  type!: ClientType;

  @ApiProperty({ example: 'Hospital Veterinário Centro' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @TaxIdProperty()
  taxId?: string | null;

  @ApiPropertyOptional({
    enum: TaxIdType,
    nullable: true,
    description: 'Always sent together with taxId.',
  })
  @IsOptional()
  @IsEnum(TaxIdType)
  taxIdType?: TaxIdType | null;

  @ApiPropertyOptional({ example: 'Dra. Ana' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactName?: string;

  @ApiPropertyOptional({ example: 'contato@hospital.com.br' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+55 51 99999-0000' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ example: 'Rua das Flores, 100' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine?: string;

  @ApiPropertyOptional({ example: 'Porto Alegre' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: 'RS' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  state?: string;

  @ApiPropertyOptional({ enum: Weekday, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(Weekday, { each: true })
  serviceDays?: Weekday[];

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsInt()
  @Min(0)
  paymentTermsDays?: number;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  preferredPaymentMethod?: PaymentMethod;
}
