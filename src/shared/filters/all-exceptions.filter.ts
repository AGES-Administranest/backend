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
 * O único lugar do sistema que monta uma resposta de erro (ADR-07).
 *
 * O NestJS embrulha todo handler num try/catch invisível: qualquer `throw` em
 * qualquer camada cai aqui. `@Catch()` sem argumento significa "pega tudo",
 * então nenhum erro escapa para o app no formato errado.
 */

/** A natureza da falha decide o status. Um lugar só, para o sistema inteiro. */
const STATUS_POR_KIND: Record<ErrorKind, number> = {
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  INVALID_INPUT: HttpStatus.BAD_REQUEST,
  INVALID_REFERENCE: HttpStatus.UNPROCESSABLE_ENTITY,
  UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
};

/** Erros que o próprio NestJS lança (rota inexistente, guard, ParseUUIDPipe…). */
const CODIGO_POR_STATUS: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: 'REQUISICAO_INVALIDA',
  [HttpStatus.UNAUTHORIZED]: 'NAO_AUTENTICADO',
  [HttpStatus.FORBIDDEN]: 'SEM_PERMISSAO',
  [HttpStatus.NOT_FOUND]: 'ROTA_NAO_ENCONTRADA',
};

interface ErroTraduzido {
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

    const erro = this.traduzir(exception);
    this.registrar(exception, request, erro);

    response.status(erro.statusCode).json({
      ...erro,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }

  /** Transforma qualquer coisa que alguém lançou no nosso formato único. */
  private traduzir(exception: unknown): ErroTraduzido {
    if (exception instanceof DomainError) {
      return {
        statusCode: STATUS_POR_KIND[exception.kind],
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    // Chegou aqui cru: alguém usou o Prisma fora de um repository, ou o código
    // do erro não está mapeado em prisma-errors.ts. É bug nosso, não do cliente.
    if (isPrismaKnownError(exception)) return this.erroInterno();

    if (exception instanceof HttpException) return this.traduzirHttp(exception);

    return this.erroInterno();
  }

  /**
   * Exceções do próprio NestJS. O caso mais comum é o `ValidationPipe`, que
   * devolve a lista de campos inválidos em `message` — o ADR-07 pede que erro
   * de validação saia no mesmo formato dos demais.
   */
  private traduzirHttp(exception: HttpException): ErroTraduzido {
    const statusCode = exception.getStatus();
    const corpo = exception.getResponse();
    const mensagens =
      typeof corpo === 'object' && corpo !== null && 'message' in corpo
        ? corpo.message
        : undefined;

    if (Array.isArray(mensagens)) {
      return {
        statusCode,
        code: 'VALIDACAO_INVALIDA',
        message: 'Requisição inválida',
        details: { campos: mensagens.map((campo: unknown) => String(campo)) },
      };
    }

    return {
      statusCode,
      code: CODIGO_POR_STATUS[statusCode] ?? 'ERRO_HTTP',
      message: typeof mensagens === 'string' ? mensagens : exception.message,
    };
  }

  /** Nada do que está dentro do erro sobe: só o log sabe o que aconteceu. */
  private erroInterno(): ErroTraduzido {
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'ERRO_INTERNO',
      message: 'Erro interno do servidor',
    };
  }

  private registrar(
    exception: unknown,
    request: Request,
    erro: ErroTraduzido,
  ): void {
    const rota = `${request.method} ${request.url}`;

    // 4xx é erro de quem chamou (basta uma linha); 5xx é problema nosso.
    if (erro.statusCode < 500) {
      this.logger.warn(`${rota} → ${erro.statusCode} ${erro.code}`);
      return;
    }

    if (isPrismaKnownError(exception)) {
      this.logger.error(
        `${rota} → erro ${exception.code} do Prisma chegou até o filtro. ` +
          'Alguém consultou o banco fora de um repository, ou falta mapear ' +
          'esse código em infra/prisma/prisma-errors.ts (ADR-01).',
        exception.stack,
      );
      return;
    }

    this.logger.error(
      `${rota} → ${erro.statusCode} ${erro.code}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
  }
}
