import archiver, { Archiver } from 'archiver';
import type { Writable } from 'node:stream';

export type ArchiveEntry<Ref> = {
  /** The path inside the zip. */
  name: string;
  /** Where the file is in the bucket. */
  key: string;
  /** Whatever the caller needs to name an entry that could not be read. */
  ref: Ref;
};

export type ZipResult<Ref> = {
  added: number;
  /** Entries whose file was no longer in the bucket. */
  missing: Ref[];
};

type WriteZipOptions<Ref> = {
  entries: ArchiveEntry<Ref>[];
  readFile: (key: string) => Promise<Uint8Array | null>;
  /** The zip is written here as it is built. */
  output: Writable;
  signal: AbortSignal;
};

/**
 * Builds the zip one file at a time into `output`.
 *
 * Each file is read, appended, and only after the archive has taken it does
 * the next one start. Appending without waiting would queue every file in
 * memory while the upload is still draining the first ones, which is exactly
 * what streaming is meant to avoid: the peak is one file plus the buffers
 * between the archive and the upload.
 *
 * When no file could be read (`added` is 0) the archive is aborted instead of
 * finished, so the caller never gets an empty zip.
 */
export async function writeZip<Ref>({
  entries,
  readFile,
  output,
  signal,
}: WriteZipOptions<Ref>): Promise<ZipResult<Ref>> {
  // Level 1: PDFs and JPEGs are already compressed, more effort buys little.
  const archive = archiver('zip', { zlib: { level: 1 } });
  const failure = new Promise<never>((_, reject) => {
    archive.once('error', reject);
    signal.addEventListener('abort', () => reject(abortReason(signal)), {
      once: true,
    });
  });
  // Raced below; this keeps it from being "unhandled" while nothing races it.
  failure.catch(() => undefined);

  archive.pipe(output);

  const missing: Ref[] = [];
  let added = 0;
  try {
    for (const entry of entries) {
      signal.throwIfAborted();
      const bytes = await Promise.race([readFile(entry.key), failure]);
      if (!bytes) {
        missing.push(entry.ref);
        continue;
      }
      await Promise.race([appendAndWait(archive, bytes, entry.name), failure]);
      added += 1;
    }

    if (added === 0) {
      archive.abort();
      return { added, missing };
    }
    await Promise.race([archive.finalize(), failure]);
    return { added, missing };
  } catch (error) {
    archive.abort();
    throw error;
  }
}

/** `append` returns at once; the `entry` event says the archive took the file. */
function appendAndWait(
  archive: Archiver,
  bytes: Uint8Array,
  name: string,
): Promise<void> {
  return new Promise(resolve => {
    const onEntry = (entry: { name: string }) => {
      if (entry.name !== name) return;
      archive.off('entry', onEntry);
      resolve();
    };
    archive.on('entry', onEntry);
    archive.append(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length), {
      name,
    });
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('The tax package was aborted');
}
