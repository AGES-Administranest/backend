import { Prisma, Trip, TripMode } from '@prisma/client';

/**
 * The rules of a trip that need no database: which fields its mode takes, and
 * whether a resent trip is the one already stored. No Nest, no Prisma Client.
 */

/** A trip as the request leaves it, after merging a PATCH into the stored one. */
export interface TripDraft {
  mode: TripMode;
  vehicleId: string | null;
  appointmentId: string | null;
  /** `undefined`: not sent, so it comes from the appointment or stays as it was. */
  clientId?: string | null;
  occurredOn: Date;
  origin: string;
  destination: string;
  distanceKm: Prisma.Decimal | null;
  /** OWN_VEHICLE: the cost the request sent, which is refused. RIDE: the fare. */
  cost: Prisma.Decimal | null;
}

export interface ModeViolations {
  missing: string[];
  notAllowed: string[];
}

/**
 * OWN_VEHICLE needs a vehicle and a distance and is priced by the server, so
 * a cost is refused. RIDE needs the fare paid and takes no vehicle; its
 * distance is optional.
 */
export function modeViolations(draft: TripDraft): ModeViolations {
  const missing: string[] = [];
  const notAllowed: string[] = [];

  if (draft.mode === TripMode.OWN_VEHICLE) {
    if (draft.vehicleId === null) missing.push('vehicleId');
    if (draft.distanceKm === null) missing.push('distanceKm');
    if (draft.cost !== null) notAllowed.push('cost');
  } else {
    if (draft.cost === null) missing.push('cost');
    if (draft.vehicleId !== null) notAllowed.push('vehicleId');
  }

  return { missing, notAllowed };
}

/**
 * Whether a resent trip is the stored one: same fields as sent, compared after
 * trimming. The cost of OWN_VEHICLE is left out, since the server prices it
 * and the vehicle may have changed since. A clientId that was not sent is not
 * compared when an appointment was, because it was filled in from it.
 */
export function isSameTrip(stored: Trip, draft: TripDraft): boolean {
  const sameClient =
    draft.clientId !== undefined
      ? stored.clientId === draft.clientId
      : draft.appointmentId !== null || stored.clientId === null;

  return (
    stored.mode === draft.mode &&
    stored.vehicleId === draft.vehicleId &&
    stored.appointmentId === draft.appointmentId &&
    sameClient &&
    stored.occurredOn.getTime() === draft.occurredOn.getTime() &&
    stored.origin === draft.origin &&
    stored.destination === draft.destination &&
    sameDecimal(stored.distanceKm, draft.distanceKm) &&
    (draft.mode === TripMode.OWN_VEHICLE ||
      sameDecimal(stored.cost, draft.cost))
  );
}

function sameDecimal(
  a: Prisma.Decimal | null,
  b: Prisma.Decimal | null,
): boolean {
  return a === null || b === null ? a === b : a.equals(b);
}
