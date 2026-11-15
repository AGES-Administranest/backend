import { randomBytes } from 'node:crypto';
import { PassThrough } from 'node:stream';

import { ArchiveEntry, writeZip } from './tax-package-archive';

function collect(stream: PassThrough): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

const entry = (index: number, key = `k${index}`): ArchiveEntry<number> => ({
  name: `NFS-e/file-${index}.pdf`,
  key,
  ref: index,
});

/** Names sit uncompressed in the local headers: counting them counts the entries. */
const entriesIn = (zip: Buffer): number =>
  zip.toString('latin1').split('PK\u0003\u0004').length - 1;

describe('writeZip', () => {
  it('writes every file as an entry of a valid zip', async () => {
    const output = new PassThrough();
    const zip = collect(output);

    const result = await writeZip({
      entries: [entry(1), entry(2)],
      readFile: () => Promise.resolve(randomBytes(1024)),
      output,
      signal: new AbortController().signal,
    });

    const bytes = await zip;
    expect(result).toEqual({ added: 2, missing: [] });
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    expect(entriesIn(bytes)).toBe(2);
    expect(bytes.toString('latin1')).toContain('NFS-e/file-1.pdf');
  });

  it('skips a file that is gone and says which', async () => {
    const output = new PassThrough();
    const zip = collect(output);

    const result = await writeZip({
      entries: [entry(1), entry(2, 'gone'), entry(3)],
      readFile: key => Promise.resolve(key === 'gone' ? null : randomBytes(64)),
      output,
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ added: 2, missing: [2] });
    expect(entriesIn(await zip)).toBe(2);
  });

  it('never finishes an empty zip', async () => {
    const output = new PassThrough();
    const written = jest.fn();
    output.on('data', written);

    const result = await writeZip({
      entries: [entry(1, 'gone')],
      readFile: () => Promise.resolve(null),
      output,
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ added: 0, missing: [1] });
    expect(written).not.toHaveBeenCalled();
    expect(output.writableEnded).toBe(false);
  });

  it('stops when the signal aborts', async () => {
    const controller = new AbortController();
    const output = new PassThrough();
    output.resume();

    const zip = writeZip({
      entries: [entry(1), entry(2), entry(3)],
      readFile: () => {
        controller.abort(new Error('timeout'));
        return Promise.resolve(randomBytes(8));
      },
      output,
      signal: controller.signal,
    });

    await expect(zip).rejects.toThrow('timeout');
  });

  it('propagates a failure reading a file', async () => {
    const output = new PassThrough();
    output.resume();

    await expect(
      writeZip({
        entries: [entry(1)],
        readFile: () => Promise.reject(new Error('S3 is down')),
        output,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('S3 is down');
  });

  it('holds back the next read while the consumer is slow', async () => {
    const FILE = 1024 * 1024;
    const output = new PassThrough({ highWaterMark: 16 * 1024 });
    let consumed = 0;
    output.on('data', (chunk: Buffer) => {
      consumed += chunk.length;
      output.pause();
      setTimeout(() => output.resume(), 1);
    });

    let reads = 0;
    let furthestAhead = 0;
    await writeZip({
      entries: Array.from({ length: 10 }, (_, index) => entry(index)),
      readFile: () => {
        reads += 1;
        furthestAhead = Math.max(furthestAhead, reads - consumed / FILE);
        return Promise.resolve(randomBytes(FILE));
      },
      output,
      signal: new AbortController().signal,
    });

    // Without backpressure all 10 would be read before the first is consumed.
    expect(furthestAhead).toBeLessThan(5);
  }, 30_000);
});
