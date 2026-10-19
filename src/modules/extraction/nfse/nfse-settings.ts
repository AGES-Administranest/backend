import type { ExtractionSettings } from '../document-extractor';

export const NFSE_SETTINGS = {
  timeoutMs: 20 * 1000,
} as const satisfies ExtractionSettings;
