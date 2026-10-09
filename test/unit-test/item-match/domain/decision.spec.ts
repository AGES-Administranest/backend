import {
  decide,
  MatchThresholds,
} from '../../../../src/modules/item-match/domain/decision';

const THRESHOLDS: MatchThresholds = {
  preselect: 0.85,
  suggest: 0.3,
  margin: 0.1,
};
const ranked = (...scores: number[]) =>
  scores.map((score, i) => ({ id: `item-${i}`, score }));

describe('decide', () => {
  it('preselects a high score with a clear lead', () => {
    expect(decide(ranked(0.95, 0.5), THRESHOLDS)).toEqual({
      decision: 'preselected',
      candidates: ranked(0.95, 0.5),
    });
  });

  it('only suggests when two items are as likely', () => {
    expect(decide(ranked(0.95, 0.9), THRESHOLDS).decision).toBe('suggested');
  });

  it('only suggests a score under the preselect threshold', () => {
    expect(decide(ranked(0.8), THRESHOLDS).decision).toBe('suggested');
  });

  it('shows at most three candidates, none under the floor', () => {
    const { candidates } = decide(ranked(0.7, 0.6, 0.5, 0.4, 0.2), THRESHOLDS);
    expect(candidates.map(c => c.score)).toEqual([0.7, 0.6, 0.5]);
  });

  it('has nothing to offer when every score is under the floor', () => {
    expect(decide(ranked(0.2), THRESHOLDS)).toEqual({
      decision: 'none',
      candidates: [],
    });
  });
});
