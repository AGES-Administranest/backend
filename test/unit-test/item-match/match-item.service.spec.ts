import { ItemCatalogEntry, ItemService } from '../../../src/modules/item';
import { ItemAliasLookup } from '../../../src/modules/item-match/item-alias-lookup';
import { MatchItemService } from '../../../src/modules/item-match/match-item.service';
import { MatchSettings } from '../../../src/modules/item-match/match-settings';

const USER = 'user-1';
const SUPPLIER = 'supplier-1';

const CATALOG: ItemCatalogEntry[] = [
  { id: 'propofol', name: 'Propofol 1% amp 20ml', unit: 'AMPOULE' },
  { id: 'seringa-3', name: 'Seringa 3ml', unit: 'UNIT' },
  { id: 'seringa-10', name: 'Seringa 10 ml', unit: 'UNIT' },
];

class FakeAliases extends ItemAliasLookup {
  readonly known = new Map<string, string>();

  findItemId(userId: string, supplierId: string, description: string) {
    return Promise.resolve(
      this.known.get(`${userId}|${supplierId}|${description}`),
    );
  }
}

describe('MatchItemService', () => {
  let aliases: FakeAliases;
  let service: MatchItemService;

  beforeEach(() => {
    aliases = new FakeAliases();
    const items = { findCatalog: () => Promise.resolve(CATALOG) };
    service = new MatchItemService(
      items as unknown as ItemService,
      aliases,
      new MatchSettings(0.85, 0.3, 0.1),
    );
  });

  it('preselects a clear text match for the user to confirm', async () => {
    const [line] = await service.matchLines(USER, ['PROPOFOL 1% AMP 20ML']);
    expect(line).toEqual({
      decision: 'preselected',
      itemId: 'propofol',
      reason: 'FUZZY',
      confidence: 1,
      candidates: [
        {
          itemId: 'propofol',
          name: 'Propofol 1% amp 20ml',
          unit: 'AMPOULE',
          score: 1,
        },
      ],
    });
  });

  it('suggests the look-alikes when the line cannot tell them apart', async () => {
    const [line] = await service.matchLines(USER, ['SERINGA DESCARTAVEL']);
    expect(line.decision).toBe('suggested');
    expect(line.itemId).toBeUndefined();
    expect(line.candidates.map(c => c.itemId).sort()).toEqual([
      'seringa-10',
      'seringa-3',
    ]);
  });

  it('offers nothing for a product not in the catalog', async () => {
    const [line] = await service.matchLines(USER, ['CAL SODADA 4,5KG']);
    expect(line).toEqual({ decision: 'none', candidates: [] });
  });

  it('links through a confirmed alias before any text match', async () => {
    aliases.known.set(`${USER}|${SUPPLIER}|diprivan 1% amp`, 'propofol');
    const [line] = await service.matchLines(
      USER,
      ['DIPRIVAN 1% AMP'],
      SUPPLIER,
    );
    expect(line).toMatchObject({
      decision: 'linked',
      itemId: 'propofol',
      reason: 'ALIAS',
      confidence: 1,
    });
  });

  it('ignores an alias to an item no longer in the catalog', async () => {
    aliases.known.set(`${USER}|${SUPPLIER}|diprivan 1% amp`, 'deleted-item');
    const [line] = await service.matchLines(
      USER,
      ['DIPRIVAN 1% AMP'],
      SUPPLIER,
    );
    expect(line.decision).toBe('none');
  });
});
