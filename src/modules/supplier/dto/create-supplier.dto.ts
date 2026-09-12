import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaxIdType } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateSupplierDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId!: string;

  @ApiProperty({ example: 'Distribuidora VetSul' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: '12.345.678/0001-90' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  taxId?: string;

  @ApiPropertyOptional({ enum: TaxIdType })
  @IsOptional()
  @IsEnum(TaxIdType)
  taxIdType?: TaxIdType;

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
}
