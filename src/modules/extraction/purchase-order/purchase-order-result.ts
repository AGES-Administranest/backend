import type {
  PartialReading,
  ReadingFailureReason,
} from '../core/pdf-document';

export type PurchaseOrderResult = {
  status: 'success' | 'failed';
  failureReason?: PurchaseOrderFailureReason;
  supplier?: ExtractedSupplier;
  invoiceNumber?: string;
  /** `YYYY-MM-DD` */
  orderDate?: string;
  totalAmount?: number;
  items: ExtractedItem[];
  /** Only when the document is past the page cap: items and totals are partial. */
  partial?: PartialReading;
};

export type PurchaseOrderFailureReason =
  ReadingFailureReason | 'no_table_found';

export type ExtractedSupplier = {
  /** Unmasked, check digits verified. */
  cnpj?: string;
  name?: string;
};

export type ExtractedItem = {
  extractedDescription: string;
  // Optional: a value missing from the document is shown as such on review,
  // never inferred from the other two.
  quantity?: number;
  unitValue?: number;
  totalValue?: number;
  arithmeticCheck: boolean;
};
