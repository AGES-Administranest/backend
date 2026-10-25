/** "Clínica Veterinária" → "Clinica Veterinaria". */
export function removeAccents(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}
