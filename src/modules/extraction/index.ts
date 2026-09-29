/** Public API of the `extraction` module. */
export type {
  ExtractedItem,
  ExtractedSupplier,
  ExtractionFailureReason,
  ExtractionResult,
  PartialReading,
} from './extraction-result';
export { ExtractionModule } from './extraction.module';
export { ExtractorStrategy, type ExtractionInput } from './extractor-strategy';
