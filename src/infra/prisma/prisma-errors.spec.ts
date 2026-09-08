import { Prisma } from '@prisma/client';

import {
  InvalidReferenceError,
  RecordNotFoundError,
  runQuery,
  UniqueConstraintError,
} from './prisma-errors';

/**
 * `fields` is not decoration: the service decides between a retryable race and
 * a conflict that needs a human by looking at it. It arrived empty for every
 * error in this project until the driver-adapter shape was handled, and nothing
 * failed loudly when it did — which is exactly why it is pinned here.
 */
describe('prisma-errors', () => {
  const knownError = (code: string, meta?: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError('boom', {
      code,
      clientVersion: 'test',
      meta,
    });

  const failWith = (error: Error) =>
    runQuery(() => {
      throw error;
    });

  describe('unique violations carry the fields that collided', () => {
    it('reads the driver-adapter shape (@prisma/adapter-pg)', async () => {
      const error = await failWith(
        knownError('P2002', {
          modelName: 'User',
          driverAdapterError: {
            name: 'DriverAdapterError',
            cause: {
              originalCode: '23505',
              kind: 'UniqueConstraintViolation',
              constraint: { fields: ['email'] },
            },
          },
        }),
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UniqueConstraintError);
      expect((error as UniqueConstraintError).fields).toEqual(['email']);
    });

    it('reads a constraint reported by index name', async () => {
      const error = await failWith(
        knownError('P2002', {
          driverAdapterError: {
            cause: { constraint: { index: 'user_email_key' } },
          },
        }),
      ).catch((e: unknown) => e);

      expect((error as UniqueConstraintError).fields).toEqual([
        'user_email_key',
      ]);
    });

    it('reads the classic engine shape (meta.target as an array)', async () => {
      const error = await failWith(
        knownError('P2002', { target: ['cognito_sub'] }),
      ).catch((e: unknown) => e);

      expect((error as UniqueConstraintError).fields).toEqual(['cognito_sub']);
    });

    it('reads the classic engine shape (meta.target as a string)', async () => {
      const error = await failWith(
        knownError('P2002', { target: 'email' }),
      ).catch((e: unknown) => e);

      expect((error as UniqueConstraintError).fields).toEqual(['email']);
    });

    it('degrades to an empty list instead of throwing on an unknown shape', async () => {
      const error = await failWith(knownError('P2002')).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(UniqueConstraintError);
      expect((error as UniqueConstraintError).fields).toEqual([]);
    });
  });

  it('translates P2025 into RecordNotFoundError', async () => {
    const error = await failWith(knownError('P2025')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RecordNotFoundError);
  });

  it('translates P2003 into InvalidReferenceError, keeping the field', async () => {
    const error = await failWith(
      knownError('P2003', {
        driverAdapterError: { cause: { constraint: { fields: ['user_id'] } } },
      }),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidReferenceError);
    expect((error as InvalidReferenceError).field).toBe('user_id');
  });

  it('lets an unmapped Prisma code rise untouched', async () => {
    const original = knownError('P2010');
    const error = await failWith(original).catch((e: unknown) => e);
    expect(error).toBe(original);
  });

  it('lets a non-Prisma error rise untouched', async () => {
    const original = new Error('connect ECONNREFUSED');
    const error = await failWith(original).catch((e: unknown) => e);
    expect(error).toBe(original);
  });

  it('returns the value when nothing fails', async () => {
    await expect(runQuery(() => Promise.resolve(42))).resolves.toBe(42);
  });
});
