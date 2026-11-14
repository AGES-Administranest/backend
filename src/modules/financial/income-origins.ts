import { EntrySource } from '@prisma/client';

/**
 * Where the income of the general report (US29) comes from: the procedures
 * done, the service invoices issued, and whatever was posted by hand.
 */
export const INCOME_ORIGINS = [
  'APPOINTMENTS',
  'SERVICE_INVOICES',
  'OTHER',
] as const;

export type IncomeOrigin = (typeof INCOME_ORIGINS)[number];

export function incomeOriginOf(source: EntrySource): IncomeOrigin {
  if (source === EntrySource.APPOINTMENT) return 'APPOINTMENTS';
  if (source === EntrySource.SERVICE_INVOICE) return 'SERVICE_INVOICES';
  return 'OTHER';
}
