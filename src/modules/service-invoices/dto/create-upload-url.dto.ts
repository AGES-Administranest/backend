import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import { SERVICE_INVOICE_UPLOAD } from '../service-invoices.constants';

export class CreateServiceInvoiceUploadUrlDto {
  @ApiProperty({ example: 'nfse-1287.pdf' })
  @IsString()
  @MaxLength(255)
  filename!: string;

  @ApiProperty({ enum: SERVICE_INVOICE_UPLOAD.allowedMimeTypes })
  @IsString()
  @IsIn(SERVICE_INVOICE_UPLOAD.allowedMimeTypes)
  fileMimeType!: (typeof SERVICE_INVOICE_UPLOAD.allowedMimeTypes)[number];

  @ApiProperty({
    example: 'a'.repeat(64),
    description: 'SHA-256 of the file, lowercase hex',
  })
  @IsString()
  @Matches(/^[a-f0-9]{64}$/, {
    message: 'fileHash must be a lowercase hex SHA-256 (64 characters)',
  })
  fileHash!: string;

  @ApiProperty({ example: 184320 })
  @IsInt()
  @Min(1)
  fileBytesSize!: number;
}
