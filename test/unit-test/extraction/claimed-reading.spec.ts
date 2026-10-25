import {
  ClaimedReading,
  runClaimedReading,
} from '../../../src/modules/extraction';

const TIMEOUT_MS = 20_000;

describe('runClaimedReading', () => {
  let reading: jest.Mocked<ClaimedReading<string>>;

  beforeEach(() => {
    reading = {
      claim: jest.fn().mockResolvedValue(true),
      current: jest.fn().mockResolvedValue('as it stands'),
      read: jest.fn().mockResolvedValue('read now'),
      release: jest.fn().mockResolvedValue(undefined),
    };
  });

  it('reads when it holds the claim', async () => {
    await expect(runClaimedReading(TIMEOUT_MS, reading)).resolves.toBe(
      'read now',
    );
    expect(reading.current).not.toHaveBeenCalled();
  });

  it('answers the row as it stands when another request holds the claim', async () => {
    reading.claim.mockResolvedValue(false);

    await expect(runClaimedReading(TIMEOUT_MS, reading)).resolves.toBe(
      'as it stands',
    );
    expect(reading.read).not.toHaveBeenCalled();
  });

  it('takes over only claims older than twice the timeout', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-19T12:00:00Z') });
    try {
      await runClaimedReading(TIMEOUT_MS, reading);

      expect(reading.claim).toHaveBeenCalledWith(
        new Date('2026-10-19T11:59:20Z'),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('releases the claim when the reading breaks, so a retry reads again', async () => {
    reading.read.mockRejectedValue(new Error('database down'));

    await expect(runClaimedReading(TIMEOUT_MS, reading)).rejects.toThrow(
      'database down',
    );
    expect(reading.release).toHaveBeenCalled();
  });
});
