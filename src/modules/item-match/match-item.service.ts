import { Injectable } from '@nestjs/common';

import {
  PreparedCatalog,
  prepareCatalog,
  rankCandidates,
} from './domain/catalog-match';
import { decide } from './domain/decision';
import { normalize } from './domain/normalize';
import { ItemAliasLookup } from './item-alias-lookup';
import { LineMatch, MatchCandidate } from './line-match';
import { MatchSettings } from './match-settings';
import { ItemService } from '../item';

/** What every line of one document is matched against. */
type MatchContext = {
  userId: string;
  supplierId?: string;
  catalog: PreparedCatalog;
  itemNames: Map<string, string>;
};

/** Alias, then text and measures against the user's catalog (US10 §4.4). */
@Injectable()
export class MatchItemService {
  constructor(
    private readonly items: ItemService,
    private readonly aliases: ItemAliasLookup,
    private readonly settings: MatchSettings,
  ) {}

  async matchLines(
    userId: string,
    descriptions: string[],
    supplierId?: string,
  ): Promise<LineMatch[]> {
    const items = await this.items.findCatalog(userId);
    const context: MatchContext = {
      userId,
      supplierId,
      catalog: prepareCatalog(items),
      itemNames: new Map(items.map(item => [item.id, item.name])),
    };
    return Promise.all(
      descriptions.map(description => this.matchLine(description, context)),
    );
  }

  private async matchLine(
    description: string,
    context: MatchContext,
  ): Promise<LineMatch> {
    const { decision, candidates } = decide(
      rankCandidates(context.catalog, description),
      this.settings,
    );
    const shown = candidates.map(({ id, score }): MatchCandidate => ({
      itemId: id,
      name: context.itemNames.get(id) ?? '',
      score: round(score),
    }));

    const aliasedItemId = await this.findAlias(description, context);
    // An alias to an item deleted since is ignored.
    if (aliasedItemId && context.itemNames.has(aliasedItemId)) {
      return {
        decision: 'linked',
        itemId: aliasedItemId,
        reason: 'ALIAS',
        confidence: 1,
        candidates: shown,
      };
    }
    if (decision === 'preselected') {
      const [best] = shown;
      return {
        decision,
        itemId: best.itemId,
        reason: 'FUZZY',
        confidence: best.score,
        candidates: shown,
      };
    }
    return { decision, candidates: shown };
  }

  private findAlias(
    description: string,
    { userId, supplierId }: MatchContext,
  ): Promise<string | undefined> {
    if (!supplierId) return Promise.resolve(undefined);
    return this.aliases.findItemId(userId, supplierId, normalize(description));
  }
}

// `match_confidence` is DECIMAL(4,3).
function round(score: number): number {
  return Math.round(score * 1000) / 1000;
}
