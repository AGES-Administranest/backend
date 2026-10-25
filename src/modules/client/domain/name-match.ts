import { removeAccents } from '../../../shared/text/accents';
import { similarity } from '../../../shared/text/trigram';

export type NameMatchOptions = { threshold: number; limit: number };

export const NAME_MATCH: NameMatchOptions = { threshold: 0.4, limit: 3 };

const LEGAL_FORMS = new Set(['ltda', 'me', 'epp', 'eireli', 'sa', 'ss', 'mei']);
const CONNECTORS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
// Most clinics share these. Left in, "Clínica Veterinária Bichos" would look
// like "CLINICA VETERINARIA EXEMPLO LTDA".
const GENERIC_WORDS = new Set([
  'clinica',
  'clinicas',
  'veterinaria',
  'veterinario',
  'hospital',
  'vet',
  'centro',
  'pet',
]);

/**
 * "CLINICA VETERINARIA EXEMPLO LTDA" → "exemplo". A name made only of generic
 * words keeps them: "Hospital Veterinário" → "hospital veterinario".
 */
export function normalizeClientName(name: string): string {
  const words = removeAccents(name)
    .toLowerCase()
    .replace(/\bs\s*[./]\s*a\b/g, 'sa')
    .split(/[^a-z0-9]+/)
    .filter(word => word && !LEGAL_FORMS.has(word) && !CONNECTORS.has(word));
  const distinctive = words.filter(word => !GENERIC_WORDS.has(word));
  return (distinctive.length > 0 ? distinctive : words).join(' ');
}

/** The candidates that look like `name`, the closest first. */
export function rankByName<T extends { name: string }>(
  name: string,
  candidates: T[],
  { threshold, limit }: NameMatchOptions = NAME_MATCH,
): T[] {
  const target = normalizeClientName(name);
  if (!target) return [];

  return candidates
    .map(candidate => ({
      candidate,
      score: similarity(target, normalizeClientName(candidate.name)),
    }))
    .filter(({ score }) => score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}
