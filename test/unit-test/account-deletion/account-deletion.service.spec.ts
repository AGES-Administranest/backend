import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

import {
  RecordNotFoundError,
  UniqueConstraintError,
} from '../../../src/infra/prisma/prisma-errors';
import { userDocumentsPrefix } from '../../../src/infra/storage';
import { DEFAULT_REAUTH_WINDOW_SEC } from '../../../src/modules/account-deletion/account-deletion.constants';
import { AccountDeletionService } from '../../../src/modules/account-deletion/account-deletion.service';
import { DomainError } from '../../../src/shared/errors/domain-error';

const USER_ID = '0b9f6c1e-7d2a-4f3b-8c5d-1a2b3c4d5e6f';
const SUB = 'cognito-sub-1';
const SUB_HASH = createHash('sha256').update(SUB).digest('hex');
const NOW = new Date('2026-11-01T12:00:00.000Z');
const NOW_SEC = NOW.getTime() / 1000;

const identity = (overrides: Record<string, unknown> = {}) => ({
  cognitoSub: SUB,
  email: 'user@example.com',
  cognitoUsername: 'username-1',
  authTime: NOW_SEC - 10,
  ...overrides,
});

const auditRow = (overrides: Record<string, unknown> = {}) => ({
  userId: USER_ID,
  cognitoSubHash: SUB_HASH,
  storagePurgedAt: null,
  identityRemovedAt: null,
  ...overrides,
});

const configWith = (window?: string) =>
  ({ get: () => window }) as unknown as ConfigService;

const codeOf = async (promise: Promise<unknown>) => {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  return error instanceof DomainError ? error.code : error;
};

describe('AccountDeletionService', () => {
  let repository: Record<string, jest.Mock>;
  let storage: { deletePrefix: jest.Mock };
  let identityProvider: { deleteUser: jest.Mock };
  let subCache: { delete: jest.Mock };
  let service: AccountDeletionService;

  const build = (window?: string) =>
    new AccountDeletionService(
      repository as never,
      storage as never,
      identityProvider,
      subCache as never,
      configWith(window),
    );

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    repository = {
      findUserIdByCognitoSub: jest.fn().mockResolvedValue(USER_ID),
      findByCognitoSubHash: jest.fn().mockResolvedValue(null),
      purge: jest.fn().mockResolvedValue(auditRow()),
      markStoragePurged: jest.fn().mockResolvedValue(undefined),
      markIdentityRemoved: jest.fn().mockResolvedValue(undefined),
    };
    storage = { deletePrefix: jest.fn().mockResolvedValue(3) };
    identityProvider = { deleteUser: jest.fn().mockResolvedValue(undefined) };
    subCache = { delete: jest.fn() };
    service = build();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('deleteAccount', () => {
    it('purges the database, then the files, then the login', async () => {
      const steps: string[] = [];
      repository.purge.mockImplementation(() => {
        steps.push('database');
        return Promise.resolve(auditRow());
      });
      storage.deletePrefix.mockImplementation(() => {
        steps.push('storage');
        return Promise.resolve(1);
      });
      identityProvider.deleteUser.mockImplementation(() => {
        steps.push('identity');
        return Promise.resolve();
      });

      await service.deleteAccount(identity());

      expect(steps).toEqual(['database', 'storage', 'identity']);
      expect(storage.deletePrefix).toHaveBeenCalledWith(
        userDocumentsPrefix(USER_ID),
      );
      expect(repository.markStoragePurged).toHaveBeenCalledWith(USER_ID);
      expect(repository.markIdentityRemoved).toHaveBeenCalledWith(USER_ID);
    });

    it('audits the hash of the sub and drops the sub from the cache', async () => {
      await service.deleteAccount(identity());

      expect(repository.purge).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ cognitoSubHash: SUB_HASH }),
      );
      expect(JSON.stringify(repository.purge.mock.calls)).not.toContain(SUB);
      expect(subCache.delete).toHaveBeenCalledWith(SUB);
    });

    it.each([
      ['the username of the token', 'username-1', 'username-1'],
      ['the sub when the token has no username', undefined, SUB],
    ])('removes the login by %s', async (_case, cognitoUsername, expected) => {
      await service.deleteAccount(identity({ cognitoUsername }));

      expect(identityProvider.deleteUser).toHaveBeenCalledWith(expected);
    });

    it.each([
      ['is older than the window', NOW_SEC - DEFAULT_REAUTH_WINDOW_SEC - 1],
      ['is missing from the token', undefined],
    ])('asks for a new login when auth_time %s', async (_case, authTime) => {
      await expect(
        codeOf(service.deleteAccount(identity({ authTime }))),
      ).resolves.toBe('REAUTH_REQUIRED');

      expect(repository.purge).not.toHaveBeenCalled();
      expect(storage.deletePrefix).not.toHaveBeenCalled();
      expect(identityProvider.deleteUser).not.toHaveBeenCalled();
    });

    it('accepts a login exactly at the edge of the window', async () => {
      await service.deleteAccount(
        identity({ authTime: NOW_SEC - DEFAULT_REAUTH_WINDOW_SEC }),
      );

      expect(repository.purge).toHaveBeenCalledTimes(1);
    });

    it('rejects an account that never existed', async () => {
      repository.findUserIdByCognitoSub.mockResolvedValue(null);

      await expect(codeOf(service.deleteAccount(identity()))).resolves.toBe(
        'USER_NOT_PROVISIONED',
      );
    });

    it('answers normally, without a fresh login, when all is already gone', async () => {
      repository.findUserIdByCognitoSub.mockResolvedValue(null);
      repository.findByCognitoSubHash.mockResolvedValue(
        auditRow({ storagePurgedAt: NOW, identityRemovedAt: NOW }),
      );

      await expect(
        service.deleteAccount(identity({ authTime: undefined })),
      ).resolves.toBeUndefined();

      expect(storage.deletePrefix).not.toHaveBeenCalled();
      expect(identityProvider.deleteUser).not.toHaveBeenCalled();
    });

    it('resumes only the step a previous attempt left pending', async () => {
      repository.findUserIdByCognitoSub.mockResolvedValue(null);
      repository.findByCognitoSubHash.mockResolvedValue(
        auditRow({ storagePurgedAt: NOW }),
      );

      await service.deleteAccount(identity());

      expect(repository.purge).not.toHaveBeenCalled();
      expect(storage.deletePrefix).not.toHaveBeenCalled();
      expect(identityProvider.deleteUser).toHaveBeenCalledTimes(1);
    });

    it('asks for a fresh login to resume a partial deletion', async () => {
      repository.findUserIdByCognitoSub.mockResolvedValue(null);
      repository.findByCognitoSubHash.mockResolvedValue(auditRow());

      await expect(
        codeOf(service.deleteAccount(identity({ authTime: undefined }))),
      ).resolves.toBe('REAUTH_REQUIRED');
    });

    it('leaves files and login alone when the transaction fails', async () => {
      repository.purge.mockRejectedValue(new Error('connection lost'));

      await expect(codeOf(service.deleteAccount(identity()))).resolves.toBe(
        'ACCOUNT_DELETION_FAILED',
      );

      expect(subCache.delete).not.toHaveBeenCalled();
      expect(storage.deletePrefix).not.toHaveBeenCalled();
      expect(identityProvider.deleteUser).not.toHaveBeenCalled();
    });

    it.each([
      ['RecordNotFoundError', new RecordNotFoundError()],
      ['UniqueConstraintError', new UniqueConstraintError([])],
    ])(
      'finishes what a concurrent request purged first (%s)',
      async (_name, error) => {
        repository.purge.mockRejectedValue(error);
        repository.findByCognitoSubHash.mockResolvedValue(auditRow());

        await service.deleteAccount(identity());

        expect(storage.deletePrefix).toHaveBeenCalledTimes(1);
        expect(identityProvider.deleteUser).toHaveBeenCalledTimes(1);
      },
    );

    it('fails when the row vanished but no deletion was recorded', async () => {
      repository.purge.mockRejectedValue(new RecordNotFoundError());

      await expect(codeOf(service.deleteAccount(identity()))).resolves.toBe(
        'ACCOUNT_DELETION_FAILED',
      );
    });

    it('keeps the login while the files are still pending', async () => {
      storage.deletePrefix.mockRejectedValue(new Error('S3 down'));

      await expect(codeOf(service.deleteAccount(identity()))).resolves.toBe(
        'ACCOUNT_DELETION_INCOMPLETE',
      );

      expect(repository.markStoragePurged).not.toHaveBeenCalled();
      expect(identityProvider.deleteUser).not.toHaveBeenCalled();
    });

    it('does not mark the identity as removed when the provider fails', async () => {
      identityProvider.deleteUser.mockRejectedValue('throttled');

      await expect(codeOf(service.deleteAccount(identity()))).resolves.toBe(
        'ACCOUNT_DELETION_INCOMPLETE',
      );

      expect(repository.markStoragePurged).toHaveBeenCalledWith(USER_ID);
      expect(repository.markIdentityRemoved).not.toHaveBeenCalled();
    });
  });

  describe('assertNotDeleted', () => {
    it('lets a sub through when it was never deleted', async () => {
      await expect(service.assertNotDeleted(SUB)).resolves.toBeUndefined();
      expect(repository.findByCognitoSubHash).toHaveBeenCalledWith(SUB_HASH);
    });

    it('rejects the sub of a deleted account', async () => {
      repository.findByCognitoSubHash.mockResolvedValue(auditRow());

      await expect(codeOf(service.assertNotDeleted(SUB))).resolves.toBe(
        'ACCOUNT_DELETED',
      );
    });
  });

  describe('reauthentication window', () => {
    it('comes from the environment', async () => {
      const strict = build('5');

      await expect(codeOf(strict.deleteAccount(identity()))).resolves.toBe(
        'REAUTH_REQUIRED',
      );
    });

    it('falls back to the default when it is blank', async () => {
      await build('  ').deleteAccount(identity());

      expect(repository.purge).toHaveBeenCalledTimes(1);
    });

    it.each(['abc', '-1', 'Infinity'])('refuses to start with %s', value => {
      expect(() => build(value)).toThrow('ACCOUNT_DELETION_REAUTH_WINDOW_SEC');
    });
  });
});
