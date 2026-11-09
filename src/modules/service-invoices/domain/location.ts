/** "City, ST" of the taker, or null when the client lacks either part. */
export function locationOf(client: {
  city: string | null;
  state: string | null;
}): string | null {
  const city = client.city?.trim();
  const state = client.state?.trim();
  return city && state ? `${city}, ${state}` : null;
}

/** What is typed in the location field: blank is the same as nothing. */
export function normalizeLocation(location: string): string | null {
  return location.trim() || null;
}
