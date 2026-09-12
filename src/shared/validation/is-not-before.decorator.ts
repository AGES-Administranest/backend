import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

import { toPeriodEnd, toPeriodStart } from './period-bounds';

/**
 * The decorated ISO 8601 date must not be earlier than the one held by
 * `startProperty` on the same object. A plain date is read as the whole day
 * (see `period-bounds.ts`), so `startDate=2026-09-01T10:00:00Z` with
 * `endDate=2026-09-01` is a valid range.
 *
 * It passes when either value is missing or is not a parseable date: those
 * are `@IsOptional` and `@IsDateString`'s findings, and one field should fail
 * for one reason at a time.
 */
export function IsNotBefore(
  startProperty: string,
  options?: ValidationOptions,
): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'isNotBefore',
      target: target.constructor,
      propertyName: String(propertyName),
      constraints: [startProperty],
      options: {
        message: `${String(propertyName)} must not be before ${startProperty}`,
        ...options,
      },
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const start = (args.object as Record<string, unknown>)[startProperty];
          if (typeof value !== 'string' || typeof start !== 'string') {
            return true;
          }

          const end = toPeriodEnd(value).getTime();
          const begin = toPeriodStart(start).getTime();
          if (Number.isNaN(end) || Number.isNaN(begin)) return true;

          return end >= begin;
        },
      },
    });
  };
}
