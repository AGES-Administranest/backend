import { Module } from '@nestjs/common';

import { ExtractorStrategy } from './extractor-strategy';
import { PdfTextExtractor } from './pdf-text-extractor';

@Module({
  providers: [{ provide: ExtractorStrategy, useClass: PdfTextExtractor }],
  exports: [ExtractorStrategy],
})
export class ExtractionModule {}
