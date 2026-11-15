import { DomainError } from '../../../shared/errors/domain-error';

/**
 * The sections of the general report (US29), in the order the document shows
 * them. The response follows this order whatever order they were asked in.
 */
export const REPORT_SECTIONS = [
  'FINANCIAL',
  'APPOINTMENTS',
  'CLIENTS',
  'STOCK',
  'SUPPLIERS',
  'TRIPS',
  'DEPRECIATION',
  'HOURLY_RATE',
] as const;

export type ReportSection = (typeof REPORT_SECTIONS)[number];

/**
 * The sections to build. Without a selection, every section: the screen
 * starts with all of them checked. An explicit empty selection is refused.
 *
 * @throws DomainError `REPORT_SECTIONS_EMPTY` when the selection is empty.
 */
export function selectedSections(
  requested: readonly ReportSection[] | undefined,
): ReportSection[] {
  if (requested === undefined) return [...REPORT_SECTIONS];

  const wanted = new Set(requested);
  if (wanted.size === 0) {
    throw new DomainError(
      'INVALID_INPUT',
      'REPORT_SECTIONS_EMPTY',
      'Select at least one section',
    );
  }
  return REPORT_SECTIONS.filter(section => wanted.has(section));
}
