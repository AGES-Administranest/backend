import { toIsoDate } from '../../../shared/dates/iso-date';
import {
  TaxPackageCollection,
  TaxPackageDocument,
} from '../../../shared/tax-package/tax-package.types';
import { removeAccents } from '../../../shared/text/accents';

const FOLDERS: Record<TaxPackageCollection, string> = {
  'service-invoices': 'NFS-e',
  'purchase-invoices': 'Compras',
};

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
};

const MAX_COUNTERPART_LENGTH = 40;

/** "Clínica Vet Nova" → "ClinicaVetNova". Only `[A-Za-z0-9]` survives. */
function counterpartLabel(name: string | null): string {
  const label = removeAccents(name ?? '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
    .slice(0, MAX_COUNTERPART_LENGTH);
  return label || 'SemNome';
}

/** 350 → "350,00": the comma the accountant reads, safe in a zip entry name. */
function amountLabel(amount: number | null): string {
  return amount === null ? 'SemValor' : amount.toFixed(2).replace('.', ',');
}

/** The MIME type is what the policy pinned; the declared name is only a fallback. */
function extensionOf(document: TaxPackageDocument): string {
  const fromMime = document.mimeType && EXTENSIONS[document.mimeType];
  if (fromMime) return fromMime;
  const fromName = /\.([A-Za-z0-9]{1,5})$/.exec(document.fileName ?? '');
  return fromName?.[1]?.toLowerCase() ?? 'pdf';
}

/**
 * The entry name of each document: `NFS-e/2026-03-15_ClinicaVetNova_350,00.pdf`.
 *
 * Readable and ASCII, one folder per kind of document. A repeated name gets
 * `_2`, `_3`… before the extension; repetition is judged ignoring case,
 * because Windows and macOS would merge two names that differ only by it.
 * The order of the input is kept, so the same period always names the same way.
 */
export function nameEntries(
  documents: TaxPackageDocument[],
): { document: TaxPackageDocument; name: string }[] {
  const used = new Set<string>();

  return documents.map(document => {
    const folder = FOLDERS[document.collection];
    const base = [
      toIsoDate(document.issueDate),
      counterpartLabel(document.counterpartName),
      amountLabel(document.amount),
    ].join('_');
    const extension = extensionOf(document);

    let name = `${folder}/${base}.${extension}`;
    for (let copy = 2; used.has(name.toLowerCase()); copy += 1) {
      name = `${folder}/${base}_${copy}.${extension}`;
    }
    used.add(name.toLowerCase());

    return { document, name };
  });
}
