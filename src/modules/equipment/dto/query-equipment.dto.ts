import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class QueryEquipmentDto {
  @ApiPropertyOptional({
    default: true,
    description:
      'Inactive equipment is only returned when explicitly set to false',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'false' ? false : value === 'true' ? true : value,
  )
  @IsBoolean()
  active?: boolean;
}
