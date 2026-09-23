import { ApiPropertyOptional } from '@nestjs/swagger';
import { AppointmentStatus, Prisma, Species } from '@prisma/client';

export class AppointmentEntity {
  id!: string;
  clientGeneratedId!: string | null;
  clientId!: string | null;
  procedureName!: string | null;
  startsAt!: Date;
  endsAt!: Date | null;
  location!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '250.00' })
  amount!: Prisma.Decimal | null;

  patientName!: string | null;
  ownerName!: string | null;
  species!: Species | null;
  patientAgeYears!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '12.500' })
  weightKg!: Prisma.Decimal | null;

  notes!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, example: 'ASA II' })
  asa!: string | null;
  status!: AppointmentStatus;
  createdAt!: Date;
  updatedAt!: Date;
  deletedAt!: Date | null;
}