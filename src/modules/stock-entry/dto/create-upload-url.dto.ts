import {
  IsIn,
  IsInt,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import { PURCHASE_INVOICE_UPLOAD } from '../stock-entry.constants';

export class CreateUploadUrlDto {
  @IsString()
  @MaxLength(255)
  filename!: string;

  @IsString()
  @IsIn(PURCHASE_INVOICE_UPLOAD.allowedMimeTypes)
  fileMimeType!: (typeof PURCHASE_INVOICE_UPLOAD.allowedMimeTypes)[number];

  @IsString()
  @Matches(/^[a-f0-9]{64}$/, {
    message: 'fileHash must be a lowercase hex SHA-256 (64 characters)',
  })
  fileHash!: string;

  @IsInt()
  @Min(1)
  fileBytesSize!: number;
}
