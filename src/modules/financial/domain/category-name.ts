/**
 * A category name as it is stored: no spaces around it and one space between
 * words, so "  Custos   fixos " is saved as "Custos fixos".
 */
export function tidyCategoryName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/**
 * The form two category names are compared in. Case and accents do not make a
 * new category: "Manutenção", "manutencao" and " MANUTENCAO " are the same one.
 * It follows the app's search normalization, so the server refuses exactly the
 * names the category field would have matched.
 */
export function categoryNameKey(name: string): string {
  return tidyCategoryName(name)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}
