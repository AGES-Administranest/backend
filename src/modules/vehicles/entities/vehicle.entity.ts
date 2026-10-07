import { ApiProperty } from '@nestjs/swagger';
import { FuelType, Prisma } from '@prisma/client';

export class VehicleEntity {
  id!: string;

  brand!: string;

  model!: string;

  @ApiProperty({ enum: FuelType })
  fuelType!: FuelType;

  @ApiProperty({ type: String })
  avgConsumptionKmL!: Prisma.Decimal;

  @ApiProperty({ type: String })
  fuelPrice!: Prisma.Decimal;

  costPerKm!: string;

  active!: boolean;

  createdAt!: Date;

  updatedAt!: Date;
}
