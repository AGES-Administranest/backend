import { User } from '@prisma/client';

import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import {
  RecordNotFoundError,
  UniqueConstraintError,
} from '../../infra/prisma/prisma-errors';
import { DomainError } from '../../shared/errors/domain-error';

/**
 * The fake repository keeps real state and enforces the same uniqueness the
 * database does: against a stateless mock the idempotency test would pass while
 * proving nothing.
 */
describe('UsersService — provisioning from Cognito', () => {
  let service: UsersService;
  let repository: FakeUsersRepository;

  beforeEach(() => {
    repository = new FakeUsersRepository();
    service = new UsersService(repository as unknown as UsersRepository);
  });

  const claims = {
    cognitoSub: 'sub-123',
    email: 'ana@example.com',
    name: 'Ana Souza',
  };

  it('creates the mirror on first login', async () => {
    const user = await service.provisionFromCognito(claims);

    expect(user.cognitoSub).toBe('sub-123');
    expect(user.email).toBe('ana@example.com');
    expect(user.name).toBe('Ana Souza');
    expect(repository.size).toBe(1);
  });

  it('does not create two users when called twice', async () => {
    const first = await service.provisionFromCognito(claims);
    const second = await service.provisionFromCognito(claims);

    expect(second.id).toBe(first.id);
    expect(repository.size).toBe(1);
  });

  it('refreshes the mirrored e-mail from the token (ADR-02)', async () => {
    await service.provisionFromCognito(claims);

    const user = await service.provisionFromCognito({
      ...claims,
      email: 'ana.souza@example.com',
    });

    expect(user.email).toBe('ana.souza@example.com');
    expect(repository.size).toBe(1);
  });

  it('keeps the stored name when the token carries no `name` claim', async () => {
    await service.provisionFromCognito(claims);

    const user = await service.provisionFromCognito({
      cognitoSub: claims.cognitoSub,
      email: claims.email,
    });

    expect(user.name).toBe('Ana Souza');
  });

  it('falls back to the e-mail as name when creating without `name`', async () => {
    const user = await service.provisionFromCognito({
      cognitoSub: 'sub-without-name',
      email: 'no-name@example.com',
    });

    expect(user.name).toBe('no-name@example.com');
  });

  it('rejects an e-mail already owned by another Cognito account', async () => {
    await service.provisionFromCognito(claims);

    const conflict = service.provisionFromCognito({
      cognitoSub: 'another-sub',
      email: claims.email,
      name: 'Same e-mail, different account',
    });

    await expect(conflict).rejects.toMatchObject({
      kind: 'CONFLICT',
      code: 'USER_EMAIL_ALREADY_REGISTERED',
    });
    await expect(conflict).rejects.toBeInstanceOf(DomainError);
  });

  it('does not report a cognito_sub collision as an e-mail conflict', async () => {
    const failing = {
      upsertByCognitoSub: () =>
        Promise.reject(new UniqueConstraintError(['cognito_sub'])),
    };
    const isolated = new UsersService(failing as unknown as UsersRepository);

    await expect(isolated.provisionFromCognito(claims)).rejects.toBeInstanceOf(
      UniqueConstraintError,
    );
  });
});

describe('UsersService — terms consent', () => {
  let service: UsersService;
  let repository: FakeUsersRepository;

  beforeEach(() => {
    repository = new FakeUsersRepository();
    service = new UsersService(repository as unknown as UsersRepository);
  });

  it('stores the date and the version of the accepted text', async () => {
    await service.provisionFromCognito({
      cognitoSub: 'sub-123',
      email: 'ana@example.com',
      name: 'Ana',
    });

    const before = Date.now();
    const user = await service.acceptTerms('sub-123', '2026-09-01');

    expect(user.termsVersion).toBe('2026-09-01');
    expect(user.termsAcceptedAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect(user.privacyAcceptedAt).toEqual(user.termsAcceptedAt);
  });

  it('fails with its own code when the mirror does not exist yet', async () => {
    const withoutMirror = service.acceptTerms('unknown-sub', '2026-09-01');

    await expect(withoutMirror).rejects.toMatchObject({
      kind: 'NOT_FOUND',
      code: 'USER_NOT_PROVISIONED',
    });
  });

  it('answers 404 and not 500 when the row vanishes mid-write', async () => {
    // Uncaught, this reaches AllExceptionsFilter as an unknown error and comes
    // out as 500, hiding a case the endpoint documents as 404.
    const vanishing = {
      updateByCognitoSub: () => Promise.reject(new RecordNotFoundError()),
    };
    const isolated = new UsersService(vanishing as unknown as UsersRepository);

    await expect(
      isolated.acceptTerms('sub-123', '2026-09-01'),
    ).rejects.toMatchObject({
      kind: 'NOT_FOUND',
      code: 'USER_NOT_PROVISIONED',
    });
  });
});

class FakeUsersRepository {
  private readonly users = new Map<string, User>();
  private sequence = 0;

  get size(): number {
    return this.users.size;
  }

  updateByCognitoSub(
    cognitoSub: string,
    data: Record<string, unknown>,
  ): Promise<User> {
    const existing = [...this.users.values()].find(
      u => u.cognitoSub === cognitoSub,
    );
    if (!existing) return Promise.reject(new RecordNotFoundError());

    return this.update(existing.id, data);
  }

  upsertByCognitoSub(
    cognitoSub: string,
    create: Record<string, unknown>,
    update: Record<string, unknown>,
  ): Promise<User> {
    const existing = [...this.users.values()].find(
      u => u.cognitoSub === cognitoSub,
    );

    const data = existing
      ? { ...existing, ...update }
      : ({
          id: `id-${++this.sequence}`,
          crmv: null,
          taxId: null,
          taxIdType: null,
          birthDate: null,
          photoUrl: null,
          termsAcceptedAt: null,
          privacyAcceptedAt: null,
          termsVersion: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          ...create,
        } as User);

    this.assertEmailFree(data);
    this.users.set(data.id, data);
    return Promise.resolve(data);
  }

  update(id: string, data: Record<string, unknown>): Promise<User> {
    const existing = this.users.get(id);
    if (!existing) return Promise.reject(new Error(`no user ${id}`));

    const updated = { ...existing, ...data };
    this.assertEmailFree(updated);
    this.users.set(id, updated);
    return Promise.resolve(updated);
  }

  private assertEmailFree(user: User): void {
    const conflict = [...this.users.values()].some(
      u => u.email === user.email && u.id !== user.id,
    );
    if (conflict) throw new UniqueConstraintError(['email']);
  }
}
