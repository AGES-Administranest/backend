/**
 * Deterministic and extension-less (D13): every presigned POST for the same
 * invoice writes to the same object, so replacing the file leaves no orphan.
 */
export function buildDocumentKey(
  userId: string,
  purchaseInvoiceId: string,
): string {
  return `users/${userId}/purchase-invoices/${purchaseInvoiceId}/original`;
}
