import { ErrorCode } from './error-codes';

/**
 * The error business rules throw (ADR-07).
 *
 * It knows nothing about HTTP: turning this into a status and a JSON body is
 * `AllExceptionsFilter`'s job. The service only says what happened and how bad
 * it is; the translation into a response happens in exactly one place.
 */

/**
 * The nature of the failure. A short, closed list on purpose: it is what the
 * filter uses to pick the HTTP status, so each new value here is a team
 * decision, not a decision by whoever is writing an endpoint.
 */
export type ErrorKind =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_INPUT'
  | 'INVALID_REFERENCE'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'PAYLOAD_TOO_LARGE';

export class DomainError extends Error {
  /**
   * @param kind  The nature of the failure — decides the HTTP status.
   * @param code  A code from the catalog in `error-codes.ts`. It is what the
   *              app uses to decide what to do, so it has to be declared there
   *              before it can be used here.
   * @param message  Text for humans. It can change at any time — the app does
   *              not depend on it. Never put internal detail here.
   * @param details  Extra data useful to the caller (which id, which field).
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
