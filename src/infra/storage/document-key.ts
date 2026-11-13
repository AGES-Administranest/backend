export type DocumentCollection = 'purchase-invoices' | 'service-invoices';

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
 * a document the user sent. Under `exports/` so one lifecycle rule can expire
 * every generated file without touching the originals.
 */
export function exportKey(
  userId: string,
  kind: 'tax-package',
  fileName: string,
): string {
  return `users/${userId}/exports/${kind}/${fileName}`;
}
