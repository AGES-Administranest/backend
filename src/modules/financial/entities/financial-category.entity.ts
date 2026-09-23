import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EntryNature, EntryScope } from '@prisma/client';

export class FinancialCategoryEntity {
  id!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  userId!: string | null;

  name!: string;

  @ApiProperty({ enum: EntryNature })
  nature!: EntryNature;

  @ApiProperty({ enum: EntryScope })
  defaultScope!: EntryScope;

  active!: boolean;

  createdAt!: Date;

  updatedAt!: Date;
}
