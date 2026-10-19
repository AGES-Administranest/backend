const MASKED = /(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g;
const DIGITS_ONLY = /(?<!\d)\d{11}(?!\d)/g;

/** Modulo 11, weights 10 to 2 for the first check digit and 11 to 2 for the second. */
export function isValidCpf(value: string): boolean {
  if (!/^\d{11}$/.test(value)) return false;
  if (/^(\d)\1{10}$/.test(value)) return false;

  const digits = [...value].map(Number);
  const first = checkDigit(digits.slice(0, 9));
  const second = checkDigit([...digits.slice(0, 9), first]);
  return digits[9] === first && digits[10] === second;
}

/** Valid CPFs, unmasked, in order, without repeats. */
export function findCpfs(text: string): string[] {
  const found = [...text.matchAll(MASKED), ...text.matchAll(DIGITS_ONLY)]
    .sort((a, b) => a.index - b.index)
    .map(match => match[0].replace(/[.-]/g, ''))
    .filter(isValidCpf);
  return [...new Set(found)];
}

function checkDigit(digits: number[]): number {
  const weight = digits.length + 1;
  const sum = digits.reduce(
    (total, digit, i) => total + digit * (weight - i),
    0,
  );
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}
