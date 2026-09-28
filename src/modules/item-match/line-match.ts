/** Why a line came linked or preselected; `purchase_invoice_line.match_reason`. */
export type MatchReason = 'ALIAS' | 'FUZZY';

export type MatchCandidate = { itemId: string; name: string; score: number };

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
