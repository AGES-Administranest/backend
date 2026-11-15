import { ApiProperty } from '@nestjs/swagger';

import { IsIsoDate } from '../../../shared/dates/iso-date';

// No `userId`: the counts are scoped to the token's owner (ADR-11).
export class QueryReportsAvailabilityDto {
  @ApiProperty({
    example: '2026-10-01',
    format: 'date',
    description: 'First day of the period, included',
  })
  @IsIsoDate()
  from!: string;

  @ApiProperty({
    example: '2026-10-31',
    format: 'date',
    description: 'Last day of the period, included. Cannot be before `from`',
  })
  @IsIsoDate()
  to!: string;
}
