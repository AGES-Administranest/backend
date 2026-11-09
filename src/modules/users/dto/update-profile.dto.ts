import { ApiPropertyOptional } from '@nestjs/swagger';
import { Sex } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateBy,
  ValidateIf,
} from 'class-validator';

import { fromIsoDate, IsIsoDate } from '../../../shared/dates/iso-date';
import { BRAZILIAN_STATES } from '../../../shared/validation/brazilian-state';

export const MIN_PROFILE_AGE = 18;
const OLDEST_BIRTH_DATE = new Date('1900-01-01T00:00:00.000Z');

const CRMV_PATTERN = new RegExp(`^(${BRAZILIAN_STATES.join('|')})-\\d{1,6}$`);

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimUpper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export function isPlausibleBirthDate(birthDate: Date, today = new Date()) {
  const latest = new Date(
    Date.UTC(
      today.getUTCFullYear() - MIN_PROFILE_AGE,
      today.getUTCMonth(),
      today.getUTCDate(),
    ),
  );
  return birthDate >= OLDEST_BIRTH_DATE && birthDate <= latest;
}

function IsPlausibleBirthDate(): PropertyDecorator {
  return ValidateBy({
    name: 'isPlausibleBirthDate',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' && isPlausibleBirthDate(fromIsoDate(value)),
      defaultMessage: () =>
        `$property must be after 1900 and at least ${MIN_PROFILE_AGE} years ago`,
    },
  });
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Ana Souza', minLength: 2, maxLength: 120 })
  @Transform(trim)
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'RS-12345',
    description: 'UF that issued it, a hyphen and up to 6 digits',
  })
  @Transform(trimUpper)
  @IsOptional()
  @IsString()
  @Matches(CRMV_PATTERN, {
    message: '$property must be the UF and the number, e.g. RS-12345',
  })
  crmv?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: true,
    example: '1990-04-15',
  })
  @IsOptional()
  @IsIsoDate()
  @IsPlausibleBirthDate()
  birthDate?: string | null;

  @ApiPropertyOptional({ enum: Sex, nullable: true })
  @IsOptional()
  @IsEnum(Sex)
  sex?: Sex | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'Porto Alegre',
    maxLength: 120,
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  city?: string | null;

  @ApiPropertyOptional({
    enum: BRAZILIAN_STATES,
    nullable: true,
    example: 'RS',
  })
  @Transform(trimUpper)
  @IsOptional()
  @IsIn(BRAZILIAN_STATES)
  state?: string | null;
}
