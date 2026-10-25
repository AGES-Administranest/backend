import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class ConfirmServiceInvoiceDto {
  @ApiPropertyOptional({
    default: false,
    description:
      'Confirms even when a registered note looks like this one, after the user saw it',
  })
  @IsOptional()
  @IsBoolean()
  allowDuplicate?: boolean;
}
