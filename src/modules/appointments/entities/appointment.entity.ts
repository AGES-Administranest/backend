import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppointmentStatus, Prisma, Species } from '@prisma/client';

import { FinancialEntryEntity } from '../../financial';

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

  @ApiProperty({ enum: AppointmentStatus })
  status!: AppointmentStatus;

  createdAt!: Date;
  updatedAt!: Date;
  deletedAt!: Date | null;
}

/** The appointment after `/complete`, with the revenue entry it posted. */
export class CompletedAppointmentEntity extends AppointmentEntity {
  financialEntry!: FinancialEntryEntity;
}

/** What the caller needs to show or resolve a clash — not the full record. */
export class ConflictingAppointmentEntity {
  id!: string;

  startsAt!: Date;

  endsAt!: Date;

  @ApiProperty({ type: String, nullable: true })
  procedureName!: string | null;
}

export class CheckConflictResultEntity {
  conflict!: boolean;

  @ApiProperty({ type: ConflictingAppointmentEntity, required: false })
  conflictingAppointment?: ConflictingAppointmentEntity;
}
