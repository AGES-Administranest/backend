/**
 * The Portuguese words the matcher knows, in one place: teaching it an
 * abbreviation or a product variant is an edit here, not in the algorithm.
 * Values stay in Portuguese: they are the vocabulary of the descriptions.
 */

/** Units a number can carry: `20ml`, `22g`, `10cm`. */
export const UNITS = new Set([
  ...['mcg', 'mg', 'g', 'kg'],
  ...['ml', 'l', 'cc', 'ui'],
  ...['cm', 'mm', 'm'],
]);

/** Supplier shorthand, spelled out. */
export const ABBREVIATIONS: Record<string, string> = {
  ag: 'agulha',
  fa: 'frasco ampola',
  fr: 'frasco',
  cx: 'caixa',
  pct: 'pacote',
  cp: 'comprimido',
  gl: 'galao',
  rl: 'rolo',
};

/** Spellings of the same product, rewritten to one. */
export const SYNONYMS: [pattern: RegExp, replacement: string][] = [
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

/** Dosage forms and the words that state them. */
export const DOSAGE_FORM_WORDS = {
  injectable: [
    ...['ampola', 'amp', 'inj', 'injetavel', 'iv', 'im'],
    ...['liof', 'liofilizado', 'endovenoso'],
  ],
  oral: [
    ...['comprimido', 'comprimidos', 'comp', 'capsula', 'capsulas', 'caps'],
    ...['gotas', 'oral', 'xarope', 'orodispersivel', 'dragea', 'drageas'],
    'mastigavel',
  ],
  topical: ['geleia', 'gel', 'pomada', 'creme', 'bisnaga', 'topico', 'topica'],
  inhaled: ['inalacao', 'inal', 'inalatorio'],
};

export type DosageForm = keyof typeof DOSAGE_FORM_WORDS;

/**
 * The dosage form a catalog unit implies. Not VIAL: the app calls it
 * "frasco", which holds inhalants, oral solutions and antiseptics as well.
 */
export const UNIT_DOSAGE_FORMS: Record<string, DosageForm | undefined> = {
  AMPOULE: 'injectable',
  TABLET: 'oral',
};

/** What "com", "sem" or "nao" can say about a product, and its words. */
export const FLAG_WORDS = {
  vasoconstrictor: ['v', 'vaso', 'vasoconstritor', 'adrenalina'],
  cuff: ['cuff'],
  needle: ['agulha'],
  powder: ['po'],
  sterile: ['esteril'],
};

export type Flag = keyof typeof FLAG_WORDS;

export function flagWords(flags: Flag[]): string[] {
  return flags.flatMap(flag => FLAG_WORDS[flag]);
}

/** Named alone, these still mean "com": "TUBO 6.0 CUFF", "GAZE ESTERIL". */
export const FLAGS_NAMED_ALONE: Flag[] = ['cuff', 'sterile'];

/** "Seringa com agulha" is a syringe: these qualify the product, never name it. */
export const QUALIFYING_FLAGS: Flag[] = ['vasoconstrictor', 'needle', 'powder'];

/**
 * Stated by the line and left unsaid by the catalog name, these make another
 * product: a syringe with a needle. Sterile and powdered are the default.
 */
export const VARIANT_FLAGS: Flag[] = ['needle', 'vasoconstrictor', 'cuff'];

/** Words the catalog name would carry if the item were that variant. */
export const VARIANT_WORDS = [
  ...['fotossensivel', 'aramado', 'preenchida', 'flush', 'bureta'],
  ...['nitrilica', 'nitrilo', 'nitrila', 'vinil', 'hiperbarica'],
  ...['pediatrico', 'neonatal', 'infantil', 'raqui', 'peridural', 'espinhal'],
  ...['heparinizada', 'gasometria'],
];

/** Glove and apron sizes. */
export const SIZE_WORDS = new Set(['pp', 'p', 'm', 'g', 'gg', 'xg', 'eg']);

/** Words that name no product. */
export const FILLER_WORDS = new Set([
  // grammar and leftovers of "c/", "s/", "nº"
  ...['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o', 'para', 'com'],
  ...['sem', 'nao', 'uso', 'n', 'no', 'tam', 'tamanho', 'x', 'c', 's', 'p'],
  // counting and packaging
  ...['un', 'und', 'unid', 'unidade', 'unidades', 'emb', 'embalagem'],
  ...['ampola', 'amp', 'frasco', 'caixa', 'pacote', 'bolsa', 'bisnaga'],
  ...['galao', 'rolo', 'envelope'],
  // dosage forms
  ...['injetavel', 'inj', 'solucao', 'sol', 'emulsao', 'po', 'liofilizado'],
  ...['comprimido', 'comp', 'capsula', 'gotas', 'oral'],
  // qualities every item of its kind has
  ...['descartavel', 'esteril', 'cuff', 'sistema', 'fechado'],
  ...['vet', 'veterinario'],
]);
