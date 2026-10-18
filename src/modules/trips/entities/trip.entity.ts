import { ApiProperty } from '@nestjs/swagger';
import { Prisma, TripMode } from '@prisma/client';

export class TripEntity {
  id!: string;
  mode!: TripMode;
  vehicleId!: string | null;
  appointmentId!: string | null;
  clientId!: string | null;
  /** YYYY-MM-DD */
  occurredOn!: string;
  origin!: string;
  destination!: string;
  // Decimals go out as strings; without the explicit type the Swagger plugin
  // points at an internal Prisma path and /docs-json fails.
  @ApiProperty({ type: String, nullable: true })
  distanceKm!: Prisma.Decimal | null;

  @ApiProperty({ type: String, nullable: true })
  costPerKm!: Prisma.Decimal | null;

  @ApiProperty({ type: String })
  cost!: Prisma.Decimal;

  createdAt!: Date;
  updatedAt!: Date;
}

export class TripListEntity {
  items!: TripEntity[];
  /** Trips in the period, across every page. */
  total!: number;
  page!: number;
  pageSize!: number;
  /** Kilometres in the period, across every page. A RIDE without a distance adds nothing. */
  totalKm!: string;
  /** Cost of the period, across every page. */
  totalCost!: string;
}
