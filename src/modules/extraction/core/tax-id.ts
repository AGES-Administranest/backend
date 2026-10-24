import { findCnpjs } from './cnpj';
import { findCpfs } from './cpf';

/** The first CNPJ in the text, else its first CPF: unmasked, check digits verified. */
export function findTaxId(text: string): string | undefined {
  return findCnpjs(text)[0] ?? findCpfs(text)[0];
}

/** `11.222.333/0001-81` → `11222333000181`, the form `findTaxId` answers in. */
export function unmaskTaxId(taxId: string): string {
  return taxId.replace(/[./-]/g, '').toUpperCase();
}
