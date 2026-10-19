import { ApiProperty } from '@nestjs/swagger';
import { ClientType, PaymentMethod, TaxIdType, Weekday } from '@prisma/client';

export class ClientEntity {
  id!: string;

  type!: ClientType;

  name!: string;

  @ApiProperty({ type: String, nullable: true })
  taxId!: string | null;

  @ApiProperty({ enum: TaxIdType, nullable: true })
  taxIdType!: TaxIdType | null;

  @ApiProperty({ type: String, nullable: true })
  contactName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true })
  addressLine!: string | null;

  @ApiProperty({ type: String, nullable: true })
  city!: string | null;

  @ApiProperty({ type: String, nullable: true })
  state!: string | null;

  @ApiProperty({ enum: Weekday, isArray: true })
  serviceDays!: Weekday[];

  @ApiProperty({ type: Number, nullable: true })
  paymentTermsDays!: number | null;

  @ApiProperty({ enum: PaymentMethod, nullable: true })
  preferredPaymentMethod!: PaymentMethod | null;

  active!: boolean;

  createdAt!: Date;

  updatedAt!: Date;
}
