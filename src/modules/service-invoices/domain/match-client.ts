export type ExtractedTaker = { name?: string; taxId?: string };

export type TakerLookups<Client> = {
  byTaxId: (taxId: string) => Promise<Client | null>;
  byName: (name: string) => Promise<Client[]>;
};

/** Neither field: the app offers to register the taker. */
export type TakerMatch<Client> = {
  clientMatch?: Client;
  clientSuggestions?: Client[];
};

/**
 * The tax id identifies the client; the name, printed as the taker's legal
 * name, only suggests. A tax id with no client still falls back to the name:
 * the client may have been registered without one.
 */
export async function matchTaker<Client>(
  taker: ExtractedTaker,
  lookups: TakerLookups<Client>,
): Promise<TakerMatch<Client>> {
  const clientMatch = taker.taxId && (await lookups.byTaxId(taker.taxId));
  if (clientMatch) return { clientMatch };

  const clientSuggestions = taker.name ? await lookups.byName(taker.name) : [];
  return clientSuggestions.length > 0 ? { clientSuggestions } : {};
}
