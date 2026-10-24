/** The steps that touch the database, given by the module that owns the row. */
export type ClaimedReading<T> = {
  /** Moves the row to PROCESSING if it is waiting for a reading. */
  claim: (staleBefore: Date) => Promise<boolean>;
  /** The row as it stands, when another request holds the claim. */
  current: () => Promise<T>;
  /** Reads the document and saves what it found. */
  read: () => Promise<T>;
  /** Puts the row back to PENDING. */
  release: () => Promise<void>;
};

/**
 * Only the request that claims the row reads it. A claim older than twice the
 * timeout was left by a process that died, so it can be taken over.
 */
export async function runClaimedReading<T>(
  timeoutMs: number,
  reading: ClaimedReading<T>,
): Promise<T> {
  const staleBefore = new Date(Date.now() - 2 * timeoutMs);
  if (!(await reading.claim(staleBefore))) return reading.current();

  try {
    return await reading.read();
  } catch (error) {
    // Left in PROCESSING, the retry would wait on a reading nobody runs.
    await reading.release();
    throw error;
  }
}
