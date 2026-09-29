import { MeasurementUnit } from '@prisma/client';

/** Why a line came linked or preselected; `purchase_invoice_line.match_reason`. */
export type MatchReason = 'ALIAS' | 'FUZZY';

/** `unit` is what the line's quantity is counted in once linked (§3.4). */
export type MatchCandidate = {
  itemId: string;
  name: string;
  unit: MeasurementUnit;
  score: number;
};

export type LineMatch = {
  /**
   * `linked` comes from a confirmed alias; a text match is at best
   * `preselected`, for the user to confirm.
   */
  decision: 'linked' | 'preselected' | 'suggested' | 'none';
  itemId?: string;
  reason?: MatchReason;
  /** For `purchase_invoice_line.match_confidence`. */
  confidence?: number;
  /** Up to three, best first. */
  candidates: MatchCandidate[];
};
