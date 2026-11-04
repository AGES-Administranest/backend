import { ApiProperty } from '@nestjs/swagger';
import { Sex } from '@prisma/client';

/**
 * What the Profile tab shows (US23). Only the fields the user fills in about
 * themselves: no `cognitoSub`, `taxId` or consent data.
 */
export class ProfileEntity {
  @ApiProperty({
    format: 'uuid',
    example: '0b6f8f0e-3c1a-4d2b-9a57-2f1c8e4d6a10',
    description: 'Local id of the user',
  })
  id!: string;

  @ApiProperty({ example: 'Ana Souza', description: 'Full name' })
  name!: string;

  @ApiProperty({
    example: 'ana@example.com',
    description: 'E-mail, mirrored from Cognito',
  })
  email!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'RS-12345',
    description:
      'Council registration. Null = not filled in; needed for reports (US28)',
  })
  crmv!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '1990-04-15T00:00:00.000Z',
    description:
      'Stored as a date; only the UTC date part is meaningful. The app ' +
      'calculates the age from it',
  })
  birthDate!: Date | null;

  @ApiProperty({
    enum: Sex,
    nullable: true,
    example: Sex.FEMALE,
    description:
      "Null = not filled in; NOT_INFORMED is the user's explicit choice",
  })
  sex!: Sex | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Porto Alegre',
    description: 'City where the professional works',
  })
  city!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'RS',
    description: 'State (UF), two-letter code',
  })
  state!: string | null;
}
