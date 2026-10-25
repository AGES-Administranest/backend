import { Injectable } from '@nestjs/common';

import {
  DocumentExtractor,
  DocumentKind,
  ExtractionInputs,
  ExtractionResults,
} from './document-extractor';
import { PurchaseOrderExtractor } from './purchase-order/purchase-order-extractor';

/** Reads bytes into fields. It never touches the bucket or the database. */
@Injectable()
export class ExtractionService {
  private readonly extractors: { [K in DocumentKind]: DocumentExtractor<K> };

  constructor(purchaseOrder: PurchaseOrderExtractor) {
    this.extractors = { 'purchase-order': purchaseOrder };
  }

  /** The reading cannot be interrupted: past the limit its answer is dropped. */
  async extract<K extends DocumentKind>(
    kind: K,
    input: ExtractionInputs[K],
  ): Promise<ExtractionResults[K]> {
    const extractor: DocumentExtractor<K> = this.extractors[kind];

    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<ExtractionResults[K]>(resolve => {
      timer = setTimeout(
        () => resolve(extractor.failed('timeout')),
        extractor.settings.timeoutMs,
      );
    });
    try {
      return await Promise.race([extractor.extract(input), timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }
}
