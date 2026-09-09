import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';

import { AuthenticatedUser } from './authenticated-user';

/**
 * TEMPORARY — delete when the guard from US34 subtask 2 lands.
 *
 * Nothing fills `request.user` yet, so every authenticated route answers 401 and
 * cannot be exercised end to end. With `DEV_AUTH_BYPASS=true` this fills it
 * without validating anything: it decodes the IdToken payload when the request
 * carries one (`npm run dev:token`), and falls back to `DEV_AUTH_*` otherwise.
 *
 * It refuses to run in production, and the flag is absent from `.env.example`
 * on purpose: turning it on has to be a deliberate act.
 */
@Injectable()
export class DevAuthMiddleware implements NestMiddleware {
  private readonly logger = new Logger(DevAuthMiddleware.name);
  private readonly fallback: AuthenticatedUser;

  constructor(private readonly config: ConfigService) {
    this.fallback = {
      cognitoSub:
        this.config.get<string>('DEV_AUTH_SUB') ??
        '00000000-0000-4000-8000-000000000001',
      email:
        this.config.get<string>('DEV_AUTH_EMAIL') ?? 'dev@administranest.local',
      name: this.config.get<string>('DEV_AUTH_NAME') ?? 'Dev Local',
    };
    this.logger.warn(
      'DEV_AUTH_BYPASS is on: tokens are NOT verified and every request is authenticated.',
    );
  }

  use(request: Request, _response: Response, next: NextFunction): void {
    const claims = this.decodeBearer(request.headers.authorization);
    (request as Request & { user: AuthenticatedUser }).user = claims ?? {
      ...this.fallback,
    };
    next();
  }

  /** Payload only: checking the signature is the guard's job, not this file's. */
  private decodeBearer(header?: string): AuthenticatedUser | null {
    const token = header?.match(/^Bearer (.+)$/i)?.[1];
    const payload = token?.split('.')[1];
    if (!payload) return null;

    try {
      const claims = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as { sub?: string; email?: string; name?: string };
      if (!claims.sub || !claims.email) return null;

      return {
        cognitoSub: claims.sub,
        email: claims.email,
        ...(claims.name ? { name: claims.name } : {}),
      };
    } catch {
      return null;
    }
  }
}
