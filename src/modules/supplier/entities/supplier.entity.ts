import { ApiProperty } from '@nestjs/swagger';
import { TaxIdType } from '@prisma/client';

export class SupplierEntity {
  id!: string;

  name!: string;

  @ApiProperty({ type: String, nullable: true })
  taxId!: string | null;

  @ApiProperty({ enum: TaxIdType, nullable: true })
  taxIdType!: TaxIdType | null;

  @ApiProperty({ type: String, nullable: true })
  contact!: string | null;

  @ApiProperty({ type: String, nullable: true })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;

  active!: boolean;

  createdAt!: Date;

  updatedAt!: Date;
}
