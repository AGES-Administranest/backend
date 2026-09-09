import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { isPrismaKnownError } from '../../infra/prisma/prisma-errors';
import { DomainError, ErrorKind } from '../errors/domain-error';
import { ErrorCode } from '../errors/error-codes';

/**
 * The only place in the system that builds an error response (ADR-07).
 *
 * NestJS wraps every handler in an invisible try/catch: any `throw` in any
 * layer lands here. `@Catch()` with no argument means "catch everything", so no
 * error escapes to the app in the wrong shape.
 */

/** The nature of the failure decides the status. One place, for the whole system. */
const STATUS_BY_KIND: Record<ErrorKind, number> = {
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  INVALID_INPUT: HttpStatus.BAD_REQUEST,
  INVALID_REFERENCE: HttpStatus.UNPROCESSABLE_ENTITY,
  UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  PAYLOAD_TOO_LARGE: HttpStatus.PAYLOAD_TOO_LARGE,
};

/** Errors NestJS itself throws (unknown route, guard, ParseUUIDPipe…). */
const CODE_BY_STATUS: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: 'REQUISICAO_INVALIDA',
  [HttpStatus.UNAUTHORIZED]: 'NAO_AUTENTICADO',
  [HttpStatus.FORBIDDEN]: 'SEM_PERMISSAO',
  [HttpStatus.NOT_FOUND]: 'ROTA_NAO_ENCONTRADA',
};

interface TranslatedError {
  statusCode: number;
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const error = this.translate(exception);
    this.record(exception, request, error);

    response.status(error.statusCode).json({
      ...error,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }

  /** Turns whatever anyone threw into our single shape. */
  private translate(exception: unknown): TranslatedError {
    if (exception instanceof DomainError) {
      return {
        statusCode: STATUS_BY_KIND[exception.kind],
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    // Arrived raw: someone used Prisma outside a repository, or the error's
    // code is not mapped in prisma-errors.ts. Our bug, not the client's.
    if (isPrismaKnownError(exception)) return this.internalError();

    if (exception instanceof HttpException)
      return this.translateHttp(exception);

    return this.internalError();
  }

  /**
   * NestJS's own exceptions. The common case is the `ValidationPipe`, which
   * returns the list of invalid fields in `message` — ADR-07 requires a
   * validation error to come out in the same shape as every other one.
   */
  private translateHttp(exception: HttpException): TranslatedError {
    const statusCode = exception.getStatus();
    const body = exception.getResponse();
    const messages =
      typeof body === 'object' && body !== null && 'message' in body
        ? body.message
        : undefined;

    if (Array.isArray(messages)) {
      return {
        statusCode,
        code: 'VALIDACAO_INVALIDA',
        message: 'Invalid request',
        details: { fields: messages.map((field: unknown) => String(field)) },
      };
    }

    return {
      statusCode,
      code: CODE_BY_STATUS[statusCode] ?? 'ERRO_HTTP',
      message: typeof messages === 'string' ? messages : exception.message,
    };
  }

  /** Nothing inside the error goes up: only the log knows what happened. */
  private internalError(): TranslatedError {
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'ERRO_INTERNO',
      message: 'Internal server error',
    };
  }

  private record(
    exception: unknown,
    request: Request,
    error: TranslatedError,
  ): void {
    const route = `${request.method} ${request.url}`;

    // 4xx is the caller's fault (one line is enough); 5xx is our problem.
    if (error.statusCode < 500) {
      this.logger.warn(`${route} → ${error.statusCode} ${error.code}`);
      return;
    }

    if (isPrismaKnownError(exception)) {
      this.logger.error(
        `${route} → Prisma error ${exception.code} reached the filter. ` +
          'Someone queried the database outside a repository, or that code is ' +
          'not mapped in infra/prisma/prisma-errors.ts (ADR-01).',
        exception.stack,
      );
      return;
    }

    this.logger.error(
      `${route} → ${error.statusCode} ${error.code}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
  }
}
