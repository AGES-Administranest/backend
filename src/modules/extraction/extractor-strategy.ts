import { ExtractionResult } from './extraction-result';

/** Abstract class, not an interface: Nest injects by token (see `DocumentStorage`). */
export abstract class ExtractorStrategy {
  abstract extract(input: ExtractionInput): Promise<ExtractionResult>;
}

export type ExtractionInput = {
  buffer: Uint8Array;
  /** As declared by the upload; the bytes are still checked. */
  mimeType: string;
  userId: string;
};
