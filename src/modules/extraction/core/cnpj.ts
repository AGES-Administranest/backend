import { isValidCnpj } from '../../../shared/validation/cnpj';

// Alphanumeric only when masked: loose, it is more often a product code.
const MASKED =
  /(?<![A-Z0-9])[A-Z0-9]{2}\.[A-Z0-9]{3}\.[A-Z0-9]{3}\/[A-Z0-9]{4}-\d{2}(?![A-Z0-9])/gi;
const DIGITS_ONLY = /(?<!\d)\d{14}(?!\d)/g;

export { isValidCnpj };

/** Valid CNPJs, unmasked, in order, without repeats. */
export function findCnpjs(text: string): string[] {
  const found = [...text.matchAll(MASKED), ...text.matchAll(DIGITS_ONLY)]
    .sort((a, b) => a.index - b.index)
    .map(match => match[0].replace(/[./-]/g, '').toUpperCase())
    .filter(isValidCnpj);
  return [...new Set(found)];
}
