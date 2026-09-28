import type { RankedCandidate } from './catalog-match';

export type MatchThresholds = {
  /** Best score from which the item comes preselected for confirmation. */
  preselect: number;
  /** Lowest score still worth showing as a candidate. */
  suggest: number;
  /** Lead the best needs over the runner-up to be preselected. */
  margin: number;
};

export const DEFAULT_MATCH_THRESHOLDS: MatchThresholds = {
  preselect: 0.85,
  suggest: 0.3,
  margin: 0.1,
};

export type FuzzyDecision = {
  decision: 'preselected' | 'suggested' | 'none';
  /** Up to three, best first; the preselected item is the first. */
  candidates: RankedCandidate[];
};

export const MAX_CANDIDATES = 3;

/**
 * US10 §4.4 bands. A text match is never linked on its own: at best it comes
 * preselected and the user confirms it.
 */
export function decide(
  ranked: RankedCandidate[],
  thresholds: MatchThresholds,
): FuzzyDecision {
  const candidates = ranked
    .filter(candidate => candidate.score >= thresholds.suggest)
    .slice(0, MAX_CANDIDATES);

  if (candidates.length === 0) return { decision: 'none', candidates };
  if (isClearWinner(ranked, thresholds)) {
    return { decision: 'preselected', candidates };
  }
  return { decision: 'suggested', candidates };
}

// High enough, and far enough ahead of the runner-up that the two are not
// look-alikes.
function isClearWinner(
  [best, runnerUp]: RankedCandidate[],
  thresholds: MatchThresholds,
): boolean {
  const lead = best.score - (runnerUp?.score ?? 0);
  return best.score >= thresholds.preselect && lead >= thresholds.margin;
}
