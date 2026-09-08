import { Prisma } from '@prisma/client';

/**
 * Database failures in the application's own vocabulary.
 *
 * Prisma signals failure with codes (`P2002`, `P2025`…) that only mean
 * something with its documentation open beside you. These classes exist so the
 * rest of the system never has to know those codes: whoever calls the database
 * gets an error with a name, not a number.
 *
 * It lives in `infra/` because translating Prisma is an infrastructure concern.
 * If the ORM ever changes, this file changes — and no other.
 */

/** UNIQUE constraint violation (e.g. e-mail already registered). */
export class UniqueConstraintError extends Error {
  constructor(readonly fields: string[]) {
    super(`Unique constraint violated: ${fields.join(', ')}`);
    this.name = 'UniqueConstraintError';
  }
}

/** The operation needed a record that does not exist (update/delete of a bad id). */
export class RecordNotFoundError extends Error {
  constructor() {
    super('Record not found');
    this.name = 'RecordNotFoundError';
  }
}

/** Foreign key violation: it points at a record that does not exist. */
export class InvalidReferenceError extends Error {
  constructor(readonly field?: string) {
    super(field ? `Invalid reference: ${field}` : 'Invalid reference');
    this.name = 'InvalidReferenceError';
  }
}

/**
 * Runs a Prisma query, translating the errors we know about.
 *
 * Every repository method goes through here. It is what keeps
 * `instanceof PrismaClientKnownRequestError && error.code === '...'` out of
 * every method of every module. An unmapped code rises untouched: an unknown
 * error must not become a generic one that hides the real problem.
 */
export async function runQuery<T>(query: () => Promise<T>): Promise<T> {
  try {
    return await query();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw translate(error);
    }
    throw error;
  }
}

function translate(error: Prisma.PrismaClientKnownRequestError): Error {
  switch (error.code) {
    case 'P2002':
      return new UniqueConstraintError(metaFields(error));
    case 'P2025':
      return new RecordNotFoundError();
    case 'P2003':
      return new InvalidReferenceError(metaFields(error)[0]);
    default:
      return error;
  }
}

/** `meta.target` arrives as a string, an array or undefined, depending on the database. */
function metaFields(error: Prisma.PrismaClientKnownRequestError): string[] {
  const target: unknown = error.meta?.target;
  if (Array.isArray(target))
    return target.map((field: unknown) => String(field));
  if (typeof target === 'string') return [target];
  return [];
}

/**
 * Did this error come from Prisma without passing through any translation?
 *
 * Used by the global filter as a safety net: if that is true up there, someone
 * queried the database outside a repository (ADR-01) or the error's code is not
 * mapped here. Either way it is our bug, and it becomes a 500 plus a log.
 */
export function isPrismaKnownError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}
