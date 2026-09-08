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

/**
 * Which fields the violated constraint covers.
 *
 * Two shapes exist, and only one of them is documented in the obvious place.
 * The classic query engine fills `meta.target`. A driver adapter — this project
 * uses `@prisma/adapter-pg` — leaves `target` undefined and nests the Postgres
 * error under `meta.driverAdapterError.cause.constraint` instead. Reading only
 * `target` therefore returned an empty list for every error in this project,
 * quietly: nothing crashes, the caller just cannot tell which field collided.
 */
function metaFields(error: Prisma.PrismaClientKnownRequestError): string[] {
  const meta = asRecord(error.meta);

  const target: unknown = meta?.target;
  if (Array.isArray(target))
    return target.map((field: unknown) => String(field));
  if (typeof target === 'string') return [target];

  const constraint = asRecord(
    asRecord(asRecord(meta?.driverAdapterError)?.cause)?.constraint,
  );

  const fields: unknown = constraint?.fields;
  if (Array.isArray(fields))
    return fields.map((field: unknown) => String(field));

  // Some constraints come back named rather than described (`user_email_key`).
  // The name still says which column it was about.
  const index: unknown = constraint?.index;
  if (typeof index === 'string') return [index];

  return [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
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
