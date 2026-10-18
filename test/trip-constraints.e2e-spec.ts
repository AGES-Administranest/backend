import { INestApplication } from '@nestjs/common';
import { Prisma, TripMode } from '@prisma/client';

import { createTestApp, resetDatabase } from './helpers/test-app';
import { PrismaService } from '../src/infra/prisma/prisma.service';

/**
 * The CHECKs of migration 20261018205653_trip_vehicle_mode, written straight
 * through Prisma: the API validates the same rules first, so only a direct
 * write proves the database refuses a trip that breaks them.
 */
describe('trip constraints (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userId: string;
  let vehicleId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    ({ id: userId } = await prisma.user.create({
      data: {
        cognitoSub: 'sub-trip-constraints',
        email: 'trip.constraints@example.com',
        name: 'Ana Souza',
      },
    }));
    ({ id: vehicleId } = await prisma.vehicle.create({
      data: {
        userId,
        brand: 'Fiat',
        model: 'Strada',
        fuelType: 'FLEX',
        avgConsumptionKmL: '12.5',
        fuelPrice: '5.899',
      },
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  const ownVehicle = (): Prisma.TripUncheckedCreateInput => ({
    userId,
    mode: TripMode.OWN_VEHICLE,
    vehicleId,
    occurredOn: new Date('2026-10-18T00:00:00.000Z'),
    origin: 'Home',
    destination: 'Clinic',
    distanceKm: '30',
    costPerKm: '0.4719',
    cost: '14.16',
  });

  const ride = (): Prisma.TripUncheckedCreateInput => ({
    userId,
    mode: TripMode.RIDE,
    occurredOn: new Date('2026-10-18T00:00:00.000Z'),
    origin: 'Clinic',
    destination: 'Home',
    cost: '32.90',
  });

  it.each([
    ['OWN_VEHICLE without a vehicle', { vehicleId: null }, 'trip_mode_fields'],
    [
      'OWN_VEHICLE without a distance',
      { distanceKm: null },
      'trip_mode_fields',
    ],
    [
      'OWN_VEHICLE without a cost per km',
      { costPerKm: null },
      'trip_mode_fields',
    ],
    ['a zero distance', { distanceKm: '0' }, 'trip_distance_km_positive'],
    ['a negative cost', { cost: '-0.01' }, 'trip_cost_non_negative'],
    [
      'a negative cost per km',
      { costPerKm: '-0.0001' },
      'trip_cost_per_km_non_negative',
    ],
  ])('refuses %s', async (_case, overrides, constraint) => {
    await expect(
      prisma.trip.create({ data: { ...ownVehicle(), ...overrides } }),
    ).rejects.toThrow(constraint);
  });

  it.each([
    ['RIDE with a vehicle', () => ({ vehicleId })],
    ['RIDE with a cost per km', () => ({ costPerKm: '0.4719' })],
  ])('refuses %s', async (_case, overrides) => {
    await expect(
      prisma.trip.create({ data: { ...ride(), ...overrides() } }),
    ).rejects.toThrow('trip_mode_fields');
  });

  it.each([
    ['OWN_VEHICLE with every field', () => ownVehicle()],
    [
      'OWN_VEHICLE that rounds to 0.00',
      () => ({ ...ownVehicle(), distanceKm: '0.01', cost: '0.00' }),
    ],
    ['RIDE without a distance', () => ride()],
    ['RIDE with a distance', () => ({ ...ride(), distanceKm: '12.4' })],
  ])('accepts %s', async (_case, data) => {
    await expect(prisma.trip.create({ data: data() })).resolves.toMatchObject({
      userId,
    });
  });

  it('keeps a vehicle that trips point at from being deleted', async () => {
    await prisma.trip.create({ data: ownVehicle() });

    await expect(
      prisma.vehicle.delete({ where: { id: vehicleId } }),
    ).rejects.toThrow();
    await expect(
      prisma.vehicle.findUnique({ where: { id: vehicleId } }),
    ).resolves.not.toBeNull();
  });
});
