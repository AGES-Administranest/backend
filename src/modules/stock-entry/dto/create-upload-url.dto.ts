import {
  IsIn,
  IsInt,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import { ALLOWED_FILE_MIME_TYPES } from '../stock-entry.constants';

export class CreateUploadUrlDto {
  @IsString()
  @MaxLength(255)
  filename!: string;

  @IsString()
  @IsIn(ALLOWED_FILE_MIME_TYPES)
  fileMimeType!: (typeof ALLOWED_FILE_MIME_TYPES)[number];

  @IsString()
  @Matches(/^[a-f0-9]{64}$/, {
    message: 'fileHash must be a lowercase hex SHA-256 (64 characters)',
  })
  fileHash!: string;

  @IsInt()
  @Min(1)
  fileBytesSize!: number;
}
