import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

import { body, createTestApp } from './helpers/test-app';

/**
 * The rate limit, and the shape it fails in.
 *
 * It is a ceiling on call volume, not a security control: the app authenticates
 * against Cognito directly, so there is no login or password-reset route here
 * for brute force or e-mail enumeration to aim at. What this protects is the
 * routes that do exist.
 *
 * The limit is deliberately high enough that the rest of the suite never
 * notices it, so this spec drives it from a public route where no token has to
 * be minted for each of the hundred-odd calls.
 */
describe('rate limiting (e2e)', () => {
  let app: INestApplication;
  let http: App;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    http = app.getHttpServer() as App;
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 429 in the shared error shape once the ceiling is passed', async () => {
    // 120 per minute, so 130 sequential calls crosses it. Sequential on
    // purpose: in parallel the throttler may admit a burst before its counter
    // catches up, which would make the test flaky rather than wrong.
    let limited: request.Response | undefined;

    for (let call = 0; call < 130 && !limited; call++) {
      const response = await request(http).get('/');
      if (response.status === 429) limited = response;
    }

    expect(limited).toBeDefined();
    expect(body(limited!)).toMatchObject({
      statusCode: 429,
      code: 'TOO_MANY_REQUESTS',
      // Not "ThrottlerException: Too Many Requests": the response says what the
      // caller should do, and nothing about what the server is built from.
      message: 'Too many requests. Try again shortly.',
    });
  });
});
