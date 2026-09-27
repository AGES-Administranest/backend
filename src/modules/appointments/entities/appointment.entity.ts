import { ApiProperty } from '@nestjs/swagger';
import { AppointmentStatus } from '@prisma/client';

export class AppointmentEntity {
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  clientId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  procedureName!: string | null;

  startsAt!: Date;

  @ApiProperty({ type: Date, nullable: true })
  endsAt!: Date | null;

  @ApiProperty({ type: String, nullable: true })
  notes!: string | null;

  @ApiProperty({ enum: AppointmentStatus })
  status!: AppointmentStatus;

  createdAt!: Date;

  updatedAt!: Date;
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
