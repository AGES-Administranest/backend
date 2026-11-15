export type DocumentCollection =
  'purchase-invoices' | 'service-invoices' | 'reports';

/**
 * Deterministic and extension-less: every presigned POST for the same
 * document writes to the same object, so replacing the file leaves no orphan.
 */
export function documentKey(
  userId: string,
  collection: DocumentCollection,
  documentId: string,
): string {
  return `users/${userId}/${collection}/${documentId}/original`;
}

/**
 * Something the API generates for the user (a zip of documents), as opposed to
 * a document the user sent. At the root, outside `users/`: a lifecycle rule
 * filters by a fixed prefix, so this is what lets `exports/` expire every
 * generated file without touching the originals (infra/storage.yaml).
 */
export function exportKey(
  userId: string,
  kind: 'tax-package',
  fileName: string,
): string {
  return `exports/users/${userId}/${kind}/${fileName}`;
}

/**
 * Every document one user sent or the API archived for them. Removing this
 * prefix removes every file the account ever uploaded, including objects whose
 * row is already gone. Generated exports (`exportKey`) live outside it and are
 * left to the lifecycle rule, which expires them in a day (ADR-15).
 */
export function userDocumentsPrefix(userId: string): string {
  return `users/${userId}/`;
}
