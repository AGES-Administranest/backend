import { ConfigService } from '@nestjs/config';

import { DEFAULT_MATCH_THRESHOLDS } from '../../../src/modules/item-match/domain/decision';
import { MatchSettings } from '../../../src/modules/item-match/match-settings';

const settingsFrom = (values: Record<string, string>) =>
  MatchSettings.fromConfig({
    get: (name: string) => values[name],
  } as unknown as ConfigService);

describe('MatchSettings.fromConfig', () => {
  it.each<Record<string, string>>([{}, { ITEM_MATCH_PRESELECT_SCORE: '' }])(
    'uses the defaults when nothing is set (%j)',
    values => {
      expect(settingsFrom(values)).toMatchObject(DEFAULT_MATCH_THRESHOLDS);
    },
  );

  it.each([
    ['ITEM_MATCH_PRESELECT_SCORE', 'preselect'],
    ['ITEM_MATCH_SUGGEST_SCORE', 'suggest'],
    ['ITEM_MATCH_MIN_LEAD', 'margin'],
  ] as const)('reads %s, both ends of the range included', (key, field) => {
    expect(settingsFrom({ [key]: '0' })[field]).toBe(0);
    expect(settingsFrom({ [key]: '0.42' })[field]).toBe(0.42);
    expect(settingsFrom({ [key]: '1' })[field]).toBe(1);
  });

  it.each(['-0.1', '1.1', 'high'])('refuses a score of %s', value => {
    expect(() => settingsFrom({ ITEM_MATCH_SUGGEST_SCORE: value })).toThrow(
      'ITEM_MATCH_SUGGEST_SCORE must be a number from 0 to 1',
    );
  });
});
