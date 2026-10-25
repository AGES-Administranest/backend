import { Module } from '@nestjs/common';

import { ExtractionService } from './extraction.service';
import { PurchaseOrderExtractor } from './purchase-order/purchase-order-extractor';

@Module({
  providers: [PurchaseOrderExtractor, ExtractionService],
  exports: [ExtractionService],
})
export class ExtractionModule {}
