import { DomainError } from '../../shared/errors/domain-error';

/**
 * One code for every report the history does not show: missing, another
 * user's (ADR-11), not stored yet, failed or deleted.
 */
export function reportNotFound(id: string): DomainError {
  return new DomainError(
    'NOT_FOUND',
    'REPORT_NOT_FOUND',
    `Report ${id} not found`,
    { id },
  );
}
