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
 * Everything stored for one user. The layout above is the only one the API
 * writes, so removing this prefix removes every file the account ever uploaded,
 * including objects whose row is already gone.
 */
export function userDocumentsPrefix(userId: string): string {
  return `users/${userId}/`;
}
