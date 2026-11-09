import { ApiProperty } from '@nestjs/swagger';

export class ReportsAvailabilityEntity {
  @ApiProperty({ description: 'Appointments starting in the period' })
  appointments!: number;

  @ApiProperty({ description: 'Financial entries accrued in the period' })
  financialEntries!: number;

  @ApiProperty({
    description: 'Confirmed service invoices issued in the period',
  })
  serviceInvoices!: number;

  @ApiProperty({
    description: 'Confirmed purchase invoices issued in the period',
  })
  purchaseInvoices!: number;

  @ApiProperty({ description: 'Stock movements that happened in the period' })
  stockMovements!: number;

  @ApiProperty({ description: 'Trips made in the period' })
  trips!: number;

  @ApiProperty({ description: 'Equipment acquired in the period' })
  equipments!: number;

  @ApiProperty({ description: 'Sum of every section above' })
  total!: number;
}
