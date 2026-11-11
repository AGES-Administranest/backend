import { ApiProperty } from '@nestjs/swagger';

export class ClientSummaryEntity {
  @ApiProperty({
    example: 13,
    description: 'Completed appointments in the period, as the history lists',
  })
  appointmentsCount!: number;

  @ApiProperty({
    type: String,
    example: '3420.00',
    description:
      'Sum of those appointments’ amounts; one without an amount adds nothing',
  })
  billedTotal!: string;

  @ApiProperty({ type: String, example: '96.50' })
  tripCost!: string;

  @ApiProperty({ example: 6 })
  tripCount!: number;
}
