import { ApiProperty } from '@nestjs/swagger';
import { AppointmentStatus, Prisma, Species } from '@prisma/client';

export class AppointmentEntity {
  id!: string;

  clientId!: string | null;

  procedureName!: string | null;

  startsAt!: Date;

  endsAt!: Date | null;

  location!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '350.00' })
  amount!: Prisma.Decimal | null;

  patientName!: string | null;

  ownerName!: string | null;

  @ApiProperty({ enum: Species, nullable: true })
  species!: Species | null;

  patientAgeYears!: number | null;

  @ApiProperty({ type: String, nullable: true, example: '12.500' })
  weightKg!: Prisma.Decimal | null;

  notes!: string | null;

  status!: AppointmentStatus;

  createdAt!: Date;

  updatedAt!: Date;

  deletedAt!: Date | null;
}
