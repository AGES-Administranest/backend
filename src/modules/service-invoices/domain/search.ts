export type InvoiceSearch = {
  /** Matched without accents or case, against the taker's name and the number. */
  text: string;
  /**
   * Digits of a date typed as `DD/MM/YYYY`, in part (`22/04`, `2204`). Absent
   * under two digits: `2` would match nearly every note.
   */
  dateDigits?: string;
};

const MIN_DATE_DIGITS = 2;

export function parseSearch(raw: string | undefined): InvoiceSearch | null {
  const text = raw?.trim();
  if (!text) return null;

  const looksLikeADate = /^[\d/]+$/.test(text);
  const digits = text.replace(/\D/g, '');
  return {
    text,
    ...(looksLikeADate &&
      digits.length >= MIN_DATE_DIGITS && { dateDigits: digits }),
  };
}

/** `%` and `_` typed by the user are letters, not wildcards. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, char => `\\${char}`);
}
