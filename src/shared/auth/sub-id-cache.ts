/**
 * Remembers which local user a Cognito `sub` maps to, so the guard does not
 * query the database on every single request.
 *
 * Only the id is cached, and that is what makes this safe without any
 * invalidation: the sub-to-id mapping never changes once the row exists. The
 * e-mail and the name are read from the token on every request — the token is
 * the source of truth for them (ADR-02), so there is nothing here to go stale.
 *
 * That matters because the app signs out at Cognito, not here: the backend
 * never sees a logout and could not invalidate on one. The TTL bounds the only
 * remaining case, a deleted account, and every query is filtered by user id
 * anyway, so a stale id selects nothing.
 */
interface Entry {
  id: string;
  expiresAt: number;
}

export class SubIdCache {
  private readonly entries = new Map<string, Entry>();

  /**
   * @param now Injected so the expiry tests can move time without fake timers.
   */
  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(cognitoSub: string): string | undefined {
    const entry = this.entries.get(cognitoSub);
    if (!entry) return undefined;

    // Expired entries are dropped when they are next asked for. There is no
    // sweeper on purpose: a background timer keeps the Node process alive and
    // leaves `app.close()` hanging in the e2e suite.
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(cognitoSub);
      return undefined;
    }

    return entry.id;
  }

  set(cognitoSub: string, id: string): void {
    // Re-inserting moves the key to the end, which keeps the eviction order
    // below meaningful.
    this.entries.delete(cognitoSub);
    this.entries.set(cognitoSub, { id, expiresAt: this.now() + this.ttlMs });

    // Oldest first. A plain FIFO rather than an LRU: every entry is the same
    // shape and the same size, and the TTL is what actually bounds staleness.
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  delete(cognitoSub: string): void {
    this.entries.delete(cognitoSub);
  }

  get size(): number {
    return this.entries.size;
  }
}
