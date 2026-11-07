import { ApiProperty } from '@nestjs/swagger';

export class ClientAppointmentEntity {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  startsAt!: Date;

  @ApiProperty({ type: String, nullable: true, example: 'Orquiectomia' })
  procedureName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Mel' })
  patientName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '620.00' })
  amount!: string | null;
}

export class ClientAppointmentListEntity {
  @ApiProperty({ type: ClientAppointmentEntity, isArray: true })
  items!: ClientAppointmentEntity[];

  @ApiProperty({
    example: 13,
    description: 'Appointments in the period, across every page',
  })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;
}
