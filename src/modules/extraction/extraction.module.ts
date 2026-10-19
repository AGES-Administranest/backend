import { Module } from '@nestjs/common';

import { ExtractionService } from './extraction.service';
import { NfseExtractor } from './nfse/nfse-extractor';
import { PurchaseOrderExtractor } from './purchase-order/purchase-order-extractor';

@Module({
  providers: [PurchaseOrderExtractor, NfseExtractor, ExtractionService],
  exports: [ExtractionService],
})
export class ExtractionModule {}
