import type { ExtractionSettings } from '../document-extractor';

export const PURCHASE_ORDER_SETTINGS = {
  timeoutMs: 20 * 1000,
} as const satisfies ExtractionSettings;
