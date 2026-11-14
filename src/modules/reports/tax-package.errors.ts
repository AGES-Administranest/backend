import { TAX_PACKAGE_LIMITS } from './reports.constants';
import { DomainError } from '../../shared/errors/domain-error';

/** Never an empty zip: the period has nothing to hand over. */
export function taxPackageEmpty(
  from: string,
  to: string,
  missingFiles: number,
): DomainError {
  return new DomainError(
    'NOT_FOUND',
    'TAX_PACKAGE_EMPTY',
    'No document with a file in the period',
    { from, to, missingFiles },
  );
}

export function taxPackageTooLarge(
  documentsCount: number,
  bytesSize: number,
): DomainError {
  return new DomainError(
    'PAYLOAD_TOO_LARGE',
    'TAX_PACKAGE_TOO_LARGE',
    'The period has more documents than one package holds. Choose a shorter period',
    {
      documentsCount,
      bytesSize,
      maxDocuments: TAX_PACKAGE_LIMITS.maxDocuments,
      maxBytesSize: TAX_PACKAGE_LIMITS.maxBytesSize,
    },
  );
}
