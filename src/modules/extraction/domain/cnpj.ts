// Alphanumeric only when masked: loose, it is more often a product code.
const MASKED =
  /(?<![A-Z0-9])[A-Z0-9]{2}\.[A-Z0-9]{3}\.[A-Z0-9]{3}\/[A-Z0-9]{4}-\d{2}(?![A-Z0-9])/gi;
const DIGITS_ONLY = /(?<!\d)\d{14}(?!\d)/g;

/** Modulo 11; since the alphanumeric CNPJ (July 2026) a character weighs its ASCII code − 48. */
export function isValidCnpj(value: string): boolean {
  const cnpj = value.toUpperCase();
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj)) return false;
  if (/^(.)\1{13}$/.test(cnpj)) return false;

  const values = [...cnpj].map(char => char.charCodeAt(0) - 48);
  const first = checkDigit(values.slice(0, 12));
  const second = checkDigit([...values.slice(0, 12), first]);
  return values[12] === first && values[13] === second;
}

/** Valid CNPJs, unmasked, in order, without repeats. */
export function findCnpjs(text: string): string[] {
  const found = [...text.matchAll(MASKED), ...text.matchAll(DIGITS_ONLY)]
    .sort((a, b) => a.index - b.index)
    .map(match => match[0].replace(/[./-]/g, '').toUpperCase())
    .filter(isValidCnpj);
  return [...new Set(found)];
}

function checkDigit(values: number[]): number {
  let sum = 0;
  let weight = 2;
  for (let i = values.length - 1; i >= 0; i--) {
    sum += values[i] * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}
