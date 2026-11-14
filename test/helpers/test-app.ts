import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { generateKeyPair, JWTVerifyGetKey, SignJWT } from 'jose';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/infra/prisma/prisma.service';
import { DocumentStorage } from '../../src/infra/storage';
import { IdentityProviderGateway } from '../../src/modules/account-deletion/identity-provider.gateway';
import { CognitoJwtVerifier, SubIdCache } from '../../src/shared/auth';
import { AllExceptionsFilter } from '../../src/shared/filters/all-exceptions.filter';
import { JSON_BODY_LIMIT } from '../../src/shared/validation/json-body-limit';

export interface TestUser {
  cognitoSub: string;
  email: string;
  name?: string;
}

export interface BearerOptions {
  /** `exp` already in the past — the case that must read as TOKEN_EXPIRED. */
  expired?: boolean;
  /** Well formed, but signed by a key the pool does not publish. */
  foreign?: boolean;
  /** How long ago the user logged in (`auth_time`). Default: just now. */
  authAgeSec?: number;
  /** A token that carries no `auth_time` at all. */
  withoutAuthTime?: boolean;
}

const ISSUER = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test';
const CLIENT_ID = 'test-client-id';

/**
 * The suite verifies real RS256 tokens through the real guard: only the key
 * source is swapped for a locally generated pair, so nothing about the
 * verification path is faked and MiniStack is not needed to run the tests.
 */
let signingKey: CryptoKey;
let strangerKey: CryptoKey;

/**
 * Tokens are minted up front so `bearer()` can be synchronous.
 *
 * Signing is async, and an async `bearer()` would force every call site into
 * `.set('Authorization', await bearer(ana))` — which, inside a supertest chain,
 * reads badly and is easy to get wrong. Paying for the tokens once in
 * `beforeAll` keeps the specs looking like ordinary request builders.
 */
const tokens = new Map<string, string>();

const keyFor = (user: TestUser, options: BearerOptions): string =>
  [
    user.cognitoSub,
    user.email,
    user.name ?? '',
    String(options.expired ?? false),
    String(options.foreign ?? false),
    String(options.authAgeSec ?? 0),
    String(options.withoutAuthTime ?? false),
  ].join('|');

/** The `cognito:username` the tokens carry, so a spec can assert it was used. */
export const usernameOf = (user: TestUser): string =>
  `username-of-${user.cognitoSub}`;

async function mint(
  user: TestUser,
  options: BearerOptions = {},
): Promise<void> {
  const token = await new SignJWT({
    token_use: 'id',
    aud: CLIENT_ID,
    email: user.email,
    'cognito:username': usernameOf(user),
    ...(options.withoutAuthTime
      ? {}
      : {
          auth_time: Math.floor(Date.now() / 1000) - (options.authAgeSec ?? 0),
        }),
    ...(user.name ? { name: user.name } : {}),
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject(user.cognitoSub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(options.expired ? '-1h' : '1h')
    .sign(options.foreign ? strangerKey : signingKey);

  tokens.set(keyFor(user, options), token);
}

/**
 * Mints the tokens a spec needs.
 *
 * Call it from `beforeAll`, after `createTestApp`, with every identity the
 * spec will authenticate as.
 */
export async function mintTokens(
  users: TestUser[],
  options: BearerOptions[] = [{}],
): Promise<void> {
  for (const user of users) {
    for (const option of options) {
      await mint(user, option);
    }
  }
}

/** An `Authorization` header value, as Cognito would issue it. */
export function bearer(user: TestUser, options: BearerOptions = {}): string {
  const token = tokens.get(keyFor(user, options));

  if (!token) {
    throw new Error(
      `No token was minted for ${keyFor(user, options)}. ` +
        'Pass this user to mintTokens() in the spec beforeAll.',
    );
  }

  return `Bearer ${token}`;
}

/**
 * Stands in for Cognito's admin API. No spec needs the emulator for it, and
 * the deletion specs need to make it fail on demand.
 */
export class FakeIdentityProvider extends IdentityProviderGateway {
  readonly deleted: string[] = [];
  /** When set, the next call throws it once and then clears it. */
  failNextWith: Error | null = null;

  deleteUser(username: string): Promise<void> {
    if (this.failNextWith) {
      const error = this.failNextWith;
      this.failNextWith = null;
      return Promise.reject(error);
    }
    this.deleted.push(username);
    return Promise.resolve();
  }
}

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  identityProvider: FakeIdentityProvider;
}

export interface TestAppOptions {
  /** Replaces the S3 client, for specs that look at what is stored. */
  storage?: DocumentStorage;
}

export async function createTestApp(
  options: TestAppOptions = {},
): Promise<TestContext> {
  const pair = await generateKeyPair('RS256', { extractable: true });
  const stranger = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  strangerKey = stranger.privateKey;
  tokens.clear();

  const keys: JWTVerifyGetKey = () => Promise.resolve(pair.publicKey);
  const identityProvider = new FakeIdentityProvider();

  const builder = Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(IdentityProviderGateway)
    .useValue(identityProvider)
    .overrideProvider(CognitoJwtVerifier)
    .useValue(
      new CognitoJwtVerifier(
        {
          jwksUri: 'http://localhost/unused',
          issuer: ISSUER,
          clientId: CLIENT_ID,
          acceptedTokenUse: ['id'],
          subCacheTtlMs: 0,
          subCacheMaxEntries: 0,
          clockToleranceSec: 5,
        },
        keys,
      ),
    )
    // A zero TTL, so an account provisioned in the middle of a test is visible
    // to the very next request rather than being masked by an entry cached a
    // moment earlier. The cache itself has its own unit spec.
    .overrideProvider(SubIdCache)
    .useValue(new SubIdCache(0, 0));

  if (options.storage) {
    builder.overrideProvider(DocumentStorage).useValue(options.storage);
  }

  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();

  // Same wiring as src/main.ts: testing against a different configuration than
  // production runs would prove nothing about production.
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  // `listen(0)` on a free port rather than `init()`: with no listening server,
  // supertest binds an ephemeral one per request, and the concurrency test
  // sends eight at once — they fight over the socket and fail as ECONNRESET,
  // which looks like an application bug and is not one.
  await app.listen(0);

  return { app, prisma: app.get(PrismaService), identityProvider };
}

/**
 * Supertest types `response.body` as `any`, which the repo's ESLint refuses.
 * Narrowing it here keeps the assertions readable without disabling the rule
 * once per test.
 */
export function body(response: { body: unknown }): Record<string, unknown> {
  return response.body as Record<string, unknown>;
}

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  // `account_deletion` has no foreign key to "user", so the cascade misses it.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "user", "account_deletion" RESTART IDENTITY CASCADE',
  );
}
