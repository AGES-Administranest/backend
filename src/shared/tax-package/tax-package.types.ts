export type TaxPackageCollection = 'service-invoices' | 'purchase-invoices';

/**
 * What one kind of document adds to the tax package summary. Both owners of a
 * document (`service-invoices`, `stock-entry`) answer in this shape, so the
 * reports module adds them up without knowing either table.
 */
export type TaxPackageTotals = {
  /** Confirmed in the period, with the file in the bucket. */
  count: number;
  /** Sum of `count`'s documents. A document with no amount adds nothing. */
  totalAmount: number;
  /** Sum of the declared file sizes of `count`'s documents. */
  bytesSize: number;
  /** Confirmed in the period, with no file in the bucket. */
  missingFiles: number;
};

/** One document that goes into the package: what names it and where its file is. */
export type TaxPackageDocument = {
  collection: TaxPackageCollection;
  id: string;
  issueDate: Date;
  /** The taker (service invoice) or the supplier (purchase invoice). */
  counterpartName: string | null;
  amount: number | null;
  fileName: string | null;
  mimeType: string | null;
};
