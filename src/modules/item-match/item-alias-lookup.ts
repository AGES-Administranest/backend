import { Injectable } from '@nestjs/common';

/**
 * Links the user already confirmed for a supplier's wording (US10 §4.3, step
 * 5). Empty until the confirmation flow records them in `item_alias`.
 */
export abstract class ItemAliasLookup {
  abstract findItemId(
    userId: string,
    supplierId: string,
    normalizedDescription: string,
  ): Promise<string | undefined>;
}

@Injectable()
export class NoItemAliases extends ItemAliasLookup {
  findItemId(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }
}
