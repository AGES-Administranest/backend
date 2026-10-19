import type { DocumentBytes, ReadingFailureReason } from './core/pdf-document';
import type { NfseResult } from './nfse/nfse-result';
import type { PurchaseOrderResult } from './purchase-order/purchase-order-result';

export type DocumentKind = 'purchase-order' | 'nfse';

export type ExtractionInputs = {
  'purchase-order': DocumentBytes;
  /** The provider is the user: their own CNPJ/CPF is never the taker's. */
  nfse: DocumentBytes & { providerTaxId?: string };
};

export type ExtractionResults = {
  'purchase-order': PurchaseOrderResult;
  nfse: NfseResult;
};

export type ExtractionSettings = {
  /** Past this the reading is dropped and answered as a `timeout` failure. */
  timeoutMs: number;
};

/** One strategy per kind of document; `ExtractionService` picks it by kind. */
export abstract class DocumentExtractor<K extends DocumentKind> {
  abstract readonly settings: ExtractionSettings;

  abstract extract(input: ExtractionInputs[K]): Promise<ExtractionResults[K]>;

  /** The answer for a document that failed before its fields were looked for. */
  abstract failed(reason: ReadingFailureReason): ExtractionResults[K];
}
