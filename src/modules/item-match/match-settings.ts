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
    const defaults = DEFAULT_MATCH_THRESHOLDS;
    return new MatchSettings(
      readScore(config, 'ITEM_MATCH_PRESELECT_SCORE', defaults.preselect),
      readScore(config, 'ITEM_MATCH_SUGGEST_SCORE', defaults.suggest),
      readScore(config, 'ITEM_MATCH_MIN_LEAD', defaults.margin),
    );
  }
}

function readScore(
  config: ConfigService,
  key: string,
  fallback: number,
): number {
  const raw = config.get<string>(key);
  if (raw === undefined || raw === '') return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${key} must be a number from 0 to 1, got "${raw}".`);
  }
  return value;
}
