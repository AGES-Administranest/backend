const FALLBACK = 'nota_fiscal.pdf';
const MAX_BASE_LENGTH = 100;

/**
 * The name the app saves the PDF under. It comes from what the user's device
 * declared, so nothing in it is trusted: no path separators, no control
 * characters, no quotes (the header wraps the name in them).
 */
export function downloadFileNameOf(declared: string | null): string {
  const base = (declared ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[/\\"]/g, '_')
    .replace(/\.pdf$/i, '')
    .replace(/^[.\s]+|\s+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    .trim();

  return base ? `${base}.pdf` : FALLBACK;
}
