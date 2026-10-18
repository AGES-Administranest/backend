import { ApiProperty } from '@nestjs/swagger';
import { Prisma, TripMode } from '@prisma/client';

// Decimals go out as strings; without the explicit type the Swagger plugin
// points at an internal Prisma path and /docs-json fails.
export class TripEntity {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: TripMode, example: TripMode.OWN_VEHICLE })
  mode!: TripMode;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description:
      'The vehicle of an OWN_VEHICLE trip, which keeps pointing at it after it ' +
      'is inactivated; null for RIDE',
  })
  vehicleId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  appointmentId!: string | null;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: "As sent, or the appointment's client when it was not sent",
  })
  clientId!: string | null;

  @ApiProperty({ format: 'date', example: '2026-10-18' })
  occurredOn!: string;

  @ApiProperty({ example: 'Casa' })
  origin!: string;

  @ApiProperty({ example: 'Clínica Veterinária São Francisco' })
  destination!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '30',
    description:
      'Kilometres as a decimal string; null for a RIDE recorded without one',
  })
  distanceKm!: Prisma.Decimal | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '0.4719',
    description:
      'R$ per km copied from the vehicle when the trip was priced, with the 4 ' +
      'places the vehicle shows: a later fuel price change leaves it as it ' +
      'is. null for RIDE',
  })
  costPerKm!: Prisma.Decimal | null;

  @ApiProperty({
    type: String,
    example: '14.16',
    description:
      'R$ as a decimal string. OWN_VEHICLE: distanceKm × costPerKm, rounded ' +
      'half-up to cents, so a very short trip can cost 0. RIDE: the fare paid',
  })
  cost!: Prisma.Decimal;

  createdAt!: Date;

  updatedAt!: Date;
}

export class TripListEntity {
  @ApiProperty({ type: TripEntity, isArray: true })
  items!: TripEntity[];

  @ApiProperty({
    example: 12,
    description: 'Trips in the period, across every page',
  })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  pageSize!: number;

  @ApiProperty({
    type: String,
    example: '412.50',
    description:
      'Kilometres of the whole period, not only the page, with 2 places. A ' +
      'RIDE without a distance adds nothing',
  })
  totalKm!: string;

  @ApiProperty({
    type: String,
    example: '238.74',
    description:
      'Cost of the whole period, not only the page, in R$ with 2 places: ' +
      'OWN_VEHICLE and RIDE trips together',
  })
  totalCost!: string;
}
