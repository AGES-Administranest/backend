import { ApiProperty } from '@nestjs/swagger';
import { FuelType, Prisma } from '@prisma/client';

export class VehicleEntity {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Fiat' })
  brand!: string;

  @ApiProperty({ example: 'Strada Freedom 1.3' })
  model!: string;

  @ApiProperty({ enum: FuelType, example: FuelType.GASOLINE })
  fuelType!: FuelType;

  @ApiProperty({
    type: String,
    example: '12.5',
    description: 'Average consumption in km per litre, as a decimal string',
  })
  avgConsumptionKmL!: Prisma.Decimal;

  @ApiProperty({
    type: String,
    example: '5.899',
    description: 'Fuel price in R$ per litre, as a decimal string',
  })
  fuelPrice!: Prisma.Decimal;

  @ApiProperty({
    type: String,
    example: '0.4719',
    description:
      'Calculated, not stored: fuelPrice / avgConsumptionKmL in R$ per km, ' +
      'as a decimal string with 4 places (half-up). Round to cents for display only.',
  })
  costPerKm!: string;

  @ApiProperty({
    example: true,
    description: 'false once inactivated; the vehicle is still readable by id',
  })
  active!: boolean;

  createdAt!: Date;

  updatedAt!: Date;
}
