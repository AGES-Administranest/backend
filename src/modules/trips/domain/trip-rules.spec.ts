import { Prisma, Trip, TripMode } from '@prisma/client';

import { isSameTrip, modeViolations, TripDraft } from './trip-rules';

const decimal = (value: string) => new Prisma.Decimal(value);

const ownVehicle = (overrides: Partial<TripDraft> = {}): TripDraft => ({
  mode: TripMode.OWN_VEHICLE,
  vehicleId: 'vehicle-1',
  appointmentId: null,
  occurredOn: new Date('2026-10-18T00:00:00.000Z'),
  origin: 'Home',
  destination: 'Clinic',
  distanceKm: decimal('30'),
  cost: null,
  ...overrides,
});

const ride = (overrides: Partial<TripDraft> = {}): TripDraft => ({
  mode: TripMode.RIDE,
  vehicleId: null,
  appointmentId: null,
  occurredOn: new Date('2026-10-18T00:00:00.000Z'),
  origin: 'Clinic',
  destination: 'Home',
  distanceKm: null,
  cost: decimal('32.90'),
  ...overrides,
});

const stored = (draft: TripDraft, overrides: Partial<Trip> = {}): Trip => ({
  id: 'trip-1',
  userId: 'user-1',
  mode: draft.mode,
  vehicleId: draft.vehicleId,
  appointmentId: draft.appointmentId,
  clientId: draft.clientId ?? null,
  occurredOn: draft.occurredOn,
  origin: draft.origin,
  destination: draft.destination,
  distanceKm: draft.distanceKm,
  costPerKm: draft.mode === TripMode.OWN_VEHICLE ? decimal('0.4719') : null,
  cost: draft.mode === TripMode.OWN_VEHICLE ? decimal('14.16') : draft.cost!,
  createdAt: new Date('2026-10-18T12:00:00.000Z'),
  updatedAt: new Date('2026-10-18T12:00:00.000Z'),
  deletedAt: null,
  ...overrides,
});

describe('modeViolations', () => {
  it.each([
    ['a complete OWN_VEHICLE trip', ownVehicle()],
    ['a RIDE trip without a distance', ride()],
    ['a RIDE trip with a distance', ride({ distanceKm: decimal('12.4') })],
  ])('accepts %s', (_case, draft) => {
    expect(modeViolations(draft)).toEqual({ missing: [], notAllowed: [] });
  });

  it.each([
    [
      'OWN_VEHICLE without a vehicle',
      ownVehicle({ vehicleId: null }),
      { missing: ['vehicleId'], notAllowed: [] },
    ],
    [
      'OWN_VEHICLE without a distance',
      ownVehicle({ distanceKm: null }),
      { missing: ['distanceKm'], notAllowed: [] },
    ],
    [
      'OWN_VEHICLE with a cost, which the server calculates',
      ownVehicle({ cost: decimal('10') }),
      { missing: [], notAllowed: ['cost'] },
    ],
    [
      'RIDE without the fare',
      ride({ cost: null }),
      { missing: ['cost'], notAllowed: [] },
    ],
    [
      'RIDE with a vehicle',
      ride({ vehicleId: 'vehicle-1' }),
      { missing: [], notAllowed: ['vehicleId'] },
    ],
    [
      'OWN_VEHICLE with nothing but a cost',
      ownVehicle({ vehicleId: null, distanceKm: null, cost: decimal('10') }),
      { missing: ['vehicleId', 'distanceKm'], notAllowed: ['cost'] },
    ],
  ])('reports %s', (_case, draft, expected) => {
    expect(modeViolations(draft)).toEqual(expected);
  });
});

describe('isSameTrip', () => {
  it.each([
    ['OWN_VEHICLE', ownVehicle()],
    ['RIDE', ride()],
  ])('matches a %s trip resent as it was', (_case, draft) => {
    expect(isSameTrip(stored(draft), draft)).toBe(true);
  });

  it('ignores the stored cost of OWN_VEHICLE, which the server priced', () => {
    const draft = ownVehicle();

    expect(isSameTrip(stored(draft, { cost: decimal('99.99') }), draft)).toBe(
      true,
    );
  });

  it('compares decimals by value, not by how they are written', () => {
    const draft = ownVehicle({ distanceKm: decimal('30') });

    expect(
      isSameTrip(stored(draft, { distanceKm: decimal('30.00') }), draft),
    ).toBe(true);
  });

  it.each([
    ['the mode', ride(), { mode: TripMode.OWN_VEHICLE }],
    ['the fare of a RIDE', ride(), { cost: decimal('33') }],
    ['the vehicle', ownVehicle(), { vehicleId: 'vehicle-2' }],
    ['the distance', ownVehicle(), { distanceKm: decimal('31') }],
    ['a distance added to a RIDE', ride(), { distanceKm: decimal('5') }],
    ['the date', ride(), { occurredOn: new Date('2026-10-17T00:00:00.000Z') }],
    ['the origin', ride(), { origin: 'Office' }],
    ['the destination', ride(), { destination: 'Office' }],
    ['the appointment', ride(), { appointmentId: 'appointment-1' }],
  ])('tells a trip with another %s apart', (_case, draft, changed) => {
    expect(isSameTrip(stored(draft, changed), draft)).toBe(false);
  });

  describe('clientId', () => {
    it('compares it when it was sent', () => {
      const draft = ride({ clientId: 'client-1' });

      expect(isSameTrip(stored(draft), draft)).toBe(true);
      expect(isSameTrip(stored(draft, { clientId: 'client-2' }), draft)).toBe(
        false,
      );
    });

    it('skips it when not sent with an appointment, which filled it in', () => {
      const draft = ride({ appointmentId: 'appointment-1' });

      expect(isSameTrip(stored(draft, { clientId: 'client-1' }), draft)).toBe(
        true,
      );
    });

    it('expects none when neither it nor an appointment was sent', () => {
      const draft = ride();

      expect(isSameTrip(stored(draft, { clientId: 'client-1' }), draft)).toBe(
        false,
      );
    });
  });
});
