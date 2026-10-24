import { Injectable } from '@nestjs/common';

import { extractNfseFields, hasAnyField, NfseFields } from './nfse-fields';
import { NfseFailureReason, NfseResult } from './nfse-result';
import { NFSE_SETTINGS } from './nfse-settings';
import { defined } from '../core/defined';
import { readPdfDocument } from '../core/pdf-document';
import { groupLines } from '../core/text-lines';
import { DocumentExtractor, ExtractionInputs } from '../document-extractor';

@Injectable()
export class NfseExtractor extends DocumentExtractor<'nfse'> {
  readonly settings = NFSE_SETTINGS;

  async extract({
    providerTaxId,
    ...bytes
  }: ExtractionInputs['nfse']): Promise<NfseResult> {
    const document = await readPdfDocument(bytes);
    if (document.status === 'failed') {
      return this.failed(document.failureReason);
    }

    const fields = extractNfseFields(groupLines(document.pages), providerTaxId);
    return {
      ...this.resultFrom(fields),
      ...defined('partial', document.partial),
    };
  }

  failed(failureReason: NfseFailureReason): NfseResult {
    return { status: 'failed', failureReason };
  }

  // A field not found is left empty for the review; none at all is a failure.
  private resultFrom(fields: NfseFields): NfseResult {
    return hasAnyField(fields)
      ? { status: 'success', ...fields }
      : this.failed('no_fields_found');
  }
}
