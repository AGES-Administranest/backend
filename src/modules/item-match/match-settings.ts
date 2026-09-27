import { ConfigService } from '@nestjs/config';

import { DEFAULT_MATCH_THRESHOLDS, MatchThresholds } from './domain/decision';

/** Decision thresholds, tunable per environment once real scores come in. */
export class MatchSettings implements MatchThresholds {
  constructor(
    readonly preselect: number,
    readonly suggest: number,
    readonly margin: number,
  ) {}

  static fromConfig(config: ConfigService): MatchSettings {
    const read = (key: string, fallback: number) => {
      const raw = config.get<string>(key);
      if (raw === undefined || raw === '') return fallback;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`${key} must be a number from 0 to 1, got "${raw}".`);
      }
      return value;
    };
    return new MatchSettings(
      read('ITEM_MATCH_PRESELECT_SCORE', DEFAULT_MATCH_THRESHOLDS.preselect),
      read('ITEM_MATCH_SUGGEST_SCORE', DEFAULT_MATCH_THRESHOLDS.suggest),
      read('ITEM_MATCH_MIN_LEAD', DEFAULT_MATCH_THRESHOLDS.margin),
    );
  }
}
