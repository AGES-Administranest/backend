import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NextFunction, Request, Response } from 'express';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/infra/prisma/prisma.service';
import { AllExceptionsFilter } from '../../src/shared/filters/all-exceptions.filter';

export interface TestUser {
  cognitoSub: string;
  email: string;
  name?: string;
}

/**
 * Header the tests use to say who is making the request.
 *
 * The guard from US34 subtask 2 is what will fill `request.user` for real. This
 * middleware fills the same slot from a header so the endpoints can be
 * exercised now — and so a request with no header still takes the real
 * unauthenticated path instead of a mocked one.
 */
export const TEST_USER_HEADER = 'x-test-user';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
}

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();

  app.use(
    (
      req: Request & { user?: TestUser },
      _res: Response,
      next: NextFunction,
    ) => {
      const header = req.headers[TEST_USER_HEADER];
      if (typeof header === 'string') req.user = JSON.parse(header) as TestUser;
      next();
    },
  );

  // Same wiring as src/main.ts: testing against a different configuration than
  // production runs would prove nothing about production.
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

  return { app, prisma: app.get(PrismaService) };
}

/** Serialized identity for the `x-test-user` header. */
export function asUser(user: TestUser): string {
  return JSON.stringify(user);
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
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "user" RESTART IDENTITY CASCADE',
  );
}
