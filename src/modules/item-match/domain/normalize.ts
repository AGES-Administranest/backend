export const UNITS = new Set([
  'mcg',
  'mg',
  'g',
  'kg',
  'ml',
  'l',
  'cc',
  'ui',
  'cm',
  'mm',
  'm',
]);

// Values stay in Portuguese: they are the vocabulary of the descriptions.
const ABBREVIATIONS: Record<string, string> = {
  ag: 'agulha',
  fa: 'frasco ampola',
  fr: 'frasco',
  cx: 'caixa',
  pct: 'pacote',
  cp: 'comprimido',
  gl: 'galao',
  rl: 'rolo',
};

const SYNONYMS: [RegExp, string][] = [
  [
    /\b(?:soro fisiol(?:ogico)?|sol(?:ucao)? fisiol(?:ogica)?|cloreto (?:de )?sodio|nacl)\b/g,
    'nacl',
  ],
  // Alone, "SF" is as often "sistema fechado".
  [/\bsf(?= 0\.9%)/g, 'nacl'],
  [/\b(?:tubo|sonda|canula) (?:endo|oro)traq\w*/g, 'tubo endotraqueal'],
  [/\b(?:balao|balonete)\b/g, 'cuff'],
  [/\bmacro(?: ?gotas)?\b/g, 'macrogotas'],
  [/\bmicro(?: ?gotas)?\b/g, 'microgotas'],
  [/\bepinefrina\b/g, 'adrenalina'],
  [/\bmetamizol\b/g, 'dipirona'],
  [/\bketamina\b/g, 'cetamina'],
];

/**
 * The same form for a document line and a catalog name: no accents, lowercase,
 * decimal point, measures glued to their unit (`20ml`), sizes as `25x7`, and
 * `c/` / `s/` spelled out.
 */
export function normalize(text: string): string {
  const spaced = text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\blote?\b\s*:?\s*\S+/g, ' ')
    .replace(/\bval(?:idade)?\b\s*:?\s*\d{1,2}\/\d{2,4}(?:\/\d{2,4})?/g, ' ')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/(\d(?:mm|cm|m)?)\s*x\s*(?=\d)/g, '$1 x ')
    .replace(/\b([cs])\/\s*/g, (_, letter: string) =>
      letter === 'c' ? ' com ' : ' sem ',
    )
    .replace(/\bp\/\s*/g, ' para ')
    .replace(/\blitros?\b/g, 'l')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z]+)\b/g, (match, digit: string, letters: string) =>
      UNITS.has(letters) ? match : `${digit} ${letters}`,
    )
    .replace(/(\d)\s+(mcg|mg|g|kg|ml|l|cc|ui|cm|mm|m)\b/g, '$1$2')
    .replace(
      /(\d+(?:\.\d+)?)(?:mm|cm|m)?\s*x\s*(\d+(?:\.\d+)?)(?:mm|cm|m)?\b/g,
      '$1x$2',
    )
    .replace(/[^a-z0-9%./: ]/g, ' ');

  const expanded = spaced
    .split(/\s+/)
    .map(token => token.replace(/^[./:]+|[./:]+$/g, ''))
    .filter(Boolean)
    .map(token => ABBREVIATIONS[token] ?? token)
    .join(' ');

  return SYNONYMS.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    expanded,
  );
}
