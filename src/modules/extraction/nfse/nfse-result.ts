import type {
  PartialReading,
  ReadingFailureReason,
} from '../core/pdf-document';

export type NfseResult = {
  status: 'success' | 'failed';
  failureReason?: NfseFailureReason;
  /** `YYYY-MM-DD` */
  issueDate?: string;
  /** Total of the services before deductions and withheld taxes. */
  grossAmount?: number;
  number?: string;
  taker?: ExtractedTaker;
  partial?: PartialReading;
};

export type NfseFailureReason = ReadingFailureReason | 'no_fields_found';

/** The clinic or hospital the service was billed to. */
export type ExtractedTaker = {
  name?: string;
  /** CNPJ or CPF, unmasked, check digits verified. */
  taxId?: string;
};
