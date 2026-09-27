import { Injectable } from '@nestjs/common';

import { prepareCatalog, rankCandidates } from './domain/catalog-match';
import { decide } from './domain/decision';
import { normalize } from './domain/normalize';
import { ItemAliasLookup } from './item-alias-lookup';
import { MatchSettings } from './match-settings';
import { ItemService } from '../item';

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
    const catalogItems = await this.items.findCatalog(userId);
    const catalog = prepareCatalog(catalogItems);
    const names = new Map(catalogItems.map(item => [item.id, item.name]));

    return Promise.all(
      descriptions.map(async (description): Promise<LineMatch> => {
        const { decision, candidates } = decide(
          rankCandidates(catalog, description),
          this.settings,
        );
        const shown = candidates.map(({ id, score }) => ({
          itemId: id,
          name: names.get(id) ?? '',
          score: round(score),
        }));

        const aliased = supplierId
          ? await this.aliases.findItemId(
              userId,
              supplierId,
              normalize(description),
            )
          : undefined;
        // An alias to an item deleted since is ignored.
        if (aliased && names.has(aliased)) {
          return {
            decision: 'linked',
            itemId: aliased,
            reason: 'ALIAS',
            confidence: 1,
            candidates: shown,
          };
        }
        if (decision === 'preselected') {
          return {
            decision,
            itemId: shown[0].itemId,
            reason: 'FUZZY',
            confidence: shown[0].score,
            candidates: shown,
          };
        }
        return { decision, candidates: shown };
      }),
    );
  }
}

// `match_confidence` is DECIMAL(4,3).
function round(score: number): number {
  return Math.round(score * 1000) / 1000;
}
