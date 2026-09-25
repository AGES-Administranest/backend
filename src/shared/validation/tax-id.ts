import { TaxIdType } from '@prisma/client';
import {
  registerDecorator,
  ValidateIf,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/** How many digits each Brazilian tax id has, written with no punctuation. */
export const TAX_ID_DIGITS: Record<TaxIdType, number> = {
  CPF: 11,
  CNPJ: 14,
};

/** The two fields as they arrive in a request body, before validation. */
export interface TaxIdPair {
  taxId?: unknown;
  taxIdType?: unknown;
}

const TAX_ID_TYPES: readonly unknown[] = Object.values(TaxIdType);

const isMissing = (value: unknown): value is null | undefined =>
  value === null || value === undefined;

export function hasTaxIdFormat(taxId: string, taxIdType: TaxIdType): boolean {
  return new RegExp(`^\\d{${TAX_ID_DIGITS[taxIdType]}}$`).test(taxId);
}

/**
 * What is wrong with a `taxId` / `taxIdType` pair, or `null` when it is valid.
 *
 * `undefined` means the field was not sent and `null` means it was sent to
 * remove the value. The two always travel together — both absent, both `null`,
 * or both set — because a number without its type cannot be checked, and a
 * type without a number describes nothing.
 *
 * A `taxIdType` outside the enum is not reported here: `@IsEnum` on that field
 * already does, and reporting it twice would only repeat the message.
 */
export function taxIdPairProblem({
  taxId,
  taxIdType,
}: TaxIdPair): string | null {
  if (taxId === undefined && taxIdType === undefined) return null;
  if (taxId === null && taxIdType === null) return null;
  if (!isMissing(taxIdType) && !TAX_ID_TYPES.includes(taxIdType)) return null;

  if (!isMissing(taxId) && typeof taxId !== 'string') {
    return 'taxId must be a string of digits';
  }
  if (isMissing(taxId) || isMissing(taxIdType)) {
    return 'taxId and taxIdType must be sent together: both set, or both null to remove the tax id';
  }

  const type = taxIdType as TaxIdType;
  if (!hasTaxIdFormat(taxId, type)) {
    return `taxId must have exactly ${TAX_ID_DIGITS[type]} digits, with no punctuation, when taxIdType is ${type}`;
  }
  return null;
}

/**
 * Validates the whole `taxId` / `taxIdType` pair from the `taxId` field.
 *
 * It runs whenever either field is present — including when only `taxIdType`
 * was sent — so it must be the only validator on `taxId`: any other one would
 * also run against a missing `taxId` and report a misleading error.
 */
export function IsValidTaxIdPair(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    ValidateIf(
      (object: TaxIdPair) =>
        object.taxId !== undefined || object.taxIdType !== undefined,
    )(target, propertyName);

    registerDecorator({
      name: 'isValidTaxIdPair',
      target: target.constructor,
      propertyName: String(propertyName),
      options: validationOptions,
      validator: {
        validate: (_value: unknown, args: ValidationArguments) =>
          taxIdPairProblem(args.object) === null,
        defaultMessage: (args: ValidationArguments) =>
          taxIdPairProblem(args.object) ?? '',
      },
    });
  };
}
