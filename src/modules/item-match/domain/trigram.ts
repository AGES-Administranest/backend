/**
 * Trigrams as `pg_trgm` builds them: each word padded with two spaces before
 * and one after, so a later move to `similarity()` in SQL scores the same.
 */
export function trigrams(text: string): Set<string> {
  const result = new Set<string>();
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!word) continue;
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) {
      result.add(padded.slice(i, i + 3));
    }
  }
  return result;
}

/** Shared trigrams over all distinct trigrams, as `pg_trgm`'s `similarity()`. */
export function similarity(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const trigram of left) if (right.has(trigram)) shared++;
  return shared / (left.size + right.size - shared);
}
