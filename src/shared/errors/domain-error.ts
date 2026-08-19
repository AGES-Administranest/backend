import { ErrorCode } from './error-codes';

/**
 * O erro que as regras de negócio lançam (ADR-07).
 *
 * Ele não sabe nada de HTTP: quem transforma isso em status e em JSON é o
 * `AllExceptionsFilter`. O Service só diz o que aconteceu e o quanto isso é
 * grave; a tradução para a resposta acontece num lugar só.
 */

/**
 * A natureza da falha. Lista curta e fechada de propósito: é ela que o filtro
 * usa para escolher o status HTTP, então cada valor novo aqui é uma decisão
 * de time, não de quem está escrevendo o endpoint.
 */
export type ErrorKind =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_INPUT'
  | 'INVALID_REFERENCE'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN';

export class DomainError extends Error {
  /**
   * @param kind  A natureza da falha — define o status HTTP.
   * @param code  Código do catálogo em `error-codes.ts`. É o que o app usa
   *              para decidir o que fazer, então precisa estar declarado lá
   *              antes de ser usado aqui.
   * @param message  Texto para humanos. Pode mudar a qualquer momento — o app
   *              não depende dele. Nunca inclua detalhe interno aqui.
   * @param details  Dados extras úteis para quem chamou (qual id, qual campo).
   */
  constructor(
    readonly kind: ErrorKind,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
