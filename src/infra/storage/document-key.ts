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
