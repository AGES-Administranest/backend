import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountDeletion } from '@prisma/client';
import { createHash } from 'node:crypto';

import {
  DEFAULT_REAUTH_WINDOW_SEC,
  RETENTION_BASIS_NONE,
} from './account-deletion.constants';
import { AccountDeletionRepository } from './account-deletion.repository';
import { IdentityProviderGateway } from './identity-provider.gateway';
import {
  RecordNotFoundError,
  UniqueConstraintError,
} from '../../infra/prisma/prisma-errors';
import { DocumentStorage, userDocumentsPrefix } from '../../infra/storage';
import type { CognitoIdentity } from '../../shared/auth';
import { SubIdCache } from '../../shared/auth';
import { DomainError } from '../../shared/errors/domain-error';

/**
 * Account deletion (US25, LGPD) — the rules; the reasoning is in ADR-15.
 *
 * Three things have to disappear, and only one of them can be transactional:
 *
 *   1. the database rows         — one transaction, all or nothing
 *   2. the S3 files              — after the commit, by prefix
 *   3. the Cognito user          — last
 *
 * Steps 2 and 3 run after the commit, never before it: a failure in the
 * transaction must leave the user with an intact account, which it could not
 * if their files or login were already gone. The audit row, written inside the
 * transaction, records which steps are still pending, so asking again picks up
 * where the last attempt stopped instead of starting over.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);
  private readonly reauthWindowSec: number;

  constructor(
    private readonly repository: AccountDeletionRepository,
    private readonly storage: DocumentStorage,
    private readonly identityProvider: IdentityProviderGateway,
    private readonly subCache: SubIdCache,
    config: ConfigService,
  ) {
    this.reauthWindowSec = reauthWindowFrom(config);
  }

  /**
   * Idempotent. A repeated call after a complete deletion answers normally; a
   * repeated call after a partial one finishes it.
   */
  async deleteAccount(identity: CognitoIdentity): Promise<void> {
    const cognitoSubHash = hashSub(identity.cognitoSub);
    const userId = await this.repository.findUserIdByCognitoSub(
      identity.cognitoSub,
    );

    let audit: AccountDeletion;

    if (userId) {
      this.assertRecentLogin(identity);
      audit = await this.purge(userId, cognitoSubHash);
      this.subCache.delete(identity.cognitoSub);
    } else {
      const previous =
        await this.repository.findByCognitoSubHash(cognitoSubHash);

      // Never had an account: the same answer the guard gives every other route.
      if (!previous) {
        throw new DomainError(
          'UNAUTHORIZED',
          'USER_NOT_PROVISIONED',
          'No local mirror for this account.',
        );
      }

      // Nothing left to do, so nothing to protect with a fresh login either.
      if (previous.storagePurgedAt && previous.identityRemovedAt) return;

      this.assertRecentLogin(identity);
      audit = previous;
    }

    await this.finish(audit, identity);
  }

  /** `POST /auth/session` must not rebuild the mirror of a deleted account. */
  async assertNotDeleted(cognitoSub: string): Promise<void> {
    const audit = await this.repository.findByCognitoSubHash(
      hashSub(cognitoSub),
    );
    if (!audit) return;

    throw new DomainError(
      'UNAUTHORIZED',
      'ACCOUNT_DELETED',
      'This account has been deleted. Sign in again.',
    );
  }

  /**
   * `auth_time` and not `iat`: a refresh issues a new token with a new `iat`
   * but keeps the original `auth_time`, so only the former proves a recent
   * login. A token without it fails closed.
   */
  private assertRecentLogin({ authTime }: CognitoIdentity): void {
    const ageSec =
      authTime === undefined ? Infinity : Date.now() / 1000 - authTime;

    if (ageSec > this.reauthWindowSec) {
      throw new DomainError(
        'UNAUTHORIZED',
        'REAUTH_REQUIRED',
        'Confirm your identity again to delete the account.',
        { maxAgeSeconds: this.reauthWindowSec },
      );
    }
  }

  private async purge(
    userId: string,
    cognitoSubHash: string,
  ): Promise<AccountDeletion> {
    try {
      const audit = await this.repository.purge(userId, {
        cognitoSubHash,
        retentionBasis: RETENTION_BASIS_NONE,
      });
      this.logger.log(`Account ${userId} deleted from the database`);
      return audit;
    } catch (error) {
      // A concurrent request deleted it first: the user row is gone from
      // under this transaction, which rolled back.
      // The other request did the work, so this one only has to finish it.
      if (
        error instanceof RecordNotFoundError ||
        error instanceof UniqueConstraintError
      ) {
        const done = await this.repository.findByCognitoSubHash(cognitoSubHash);
        if (done) return done;
      }

      this.logger.error(
        `Deleting account ${userId} failed and was rolled back`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new DomainError(
        'INTERNAL',
        'ACCOUNT_DELETION_FAILED',
        'The account could not be deleted and nothing was changed. Try again.',
      );
    }
  }

  private async finish(
    audit: AccountDeletion,
    identity: CognitoIdentity,
  ): Promise<void> {
    try {
      if (!audit.storagePurgedAt) {
        const removed = await this.storage.deletePrefix(
          userDocumentsPrefix(audit.userId),
        );
        await this.repository.markStoragePurged(audit.userId);
        this.logger.log(
          `Account ${audit.userId}: ${removed} stored file(s) removed`,
        );
      }

      // Last, on purpose: while it is pending, the token that authorizes
      // another attempt is still obtainable.
      if (!audit.identityRemovedAt) {
        await this.identityProvider.deleteUser(
          identity.cognitoUsername ?? identity.cognitoSub,
        );
        await this.repository.markIdentityRemoved(audit.userId);
        this.logger.log(`Account ${audit.userId}: identity removed`);
      }
    } catch (error) {
      this.logger.error(
        `Account ${audit.userId} deleted from the database, but cleanup is pending`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new DomainError(
        'INTERNAL',
        'ACCOUNT_DELETION_INCOMPLETE',
        'Your data was deleted, but the account closure did not finish. Try again.',
      );
    }
  }
}

/**
 * Not the Cognito sub itself: the audit has to outlive the account without
 * being a list of identifiers that point at real people.
 */
function hashSub(cognitoSub: string): string {
  return createHash('sha256').update(cognitoSub).digest('hex');
}

function reauthWindowFrom(config: ConfigService): number {
  const raw = config.get<string>('ACCOUNT_DELETION_REAUTH_WINDOW_SEC');
  if (raw === undefined || String(raw).trim() === '') {
    return DEFAULT_REAUTH_WINDOW_SEC;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `ACCOUNT_DELETION_REAUTH_WINDOW_SEC must be a non-negative number, got "${raw}".`,
    );
  }
  return parsed;
}
