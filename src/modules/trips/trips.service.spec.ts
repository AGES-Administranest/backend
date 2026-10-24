import { Prisma, Trip, TripMode } from '@prisma/client';

import { CreateTripDto } from './dto/create-trip.dto';
import { TripsService } from './trips.service';
import { UniqueConstraintError } from '../../infra/prisma/prisma-errors';
import { DomainError, ErrorKind } from '../../shared/errors/domain-error';
import { ErrorCode } from '../../shared/errors/error-codes';

const decimal = (value: string) => new Prisma.Decimal(value);

const trip = (overrides: Partial<Trip> = {}): Trip => ({
  id: 'trip-1',
  userId: 'user-1',
  mode: TripMode.OWN_VEHICLE,
  vehicleId: 'vehicle-1',
  appointmentId: null,
  clientId: null,
  occurredOn: new Date('2026-10-18T00:00:00.000Z'),
  origin: 'Home',
  destination: 'Clinic',
  distanceKm: decimal('300'),
  costPerKm: decimal('0.4719'),
  cost: decimal('141.57'),
  createdAt: new Date('2026-10-18T12:00:00.000Z'),
  updatedAt: new Date('2026-10-18T12:00:00.000Z'),
  deletedAt: null,
  ...overrides,
});

const rideTrip = (overrides: Partial<Trip> = {}): Trip =>
  trip({
    mode: TripMode.RIDE,
    vehicleId: null,
    distanceKm: null,
    costPerKm: null,
    cost: decimal('32.9'),
    ...overrides,
  });

const ownDto = (overrides: Partial<CreateTripDto> = {}): CreateTripDto => ({
  mode: TripMode.OWN_VEHICLE,
  vehicleId: 'vehicle-1',
  occurredOn: '2026-10-18',
  origin: 'Home',
  destination: 'Clinic',
  distanceKm: 300,
  ...overrides,
});

const rideDto = (overrides: Partial<CreateTripDto> = {}): CreateTripDto => ({
  mode: TripMode.RIDE,
  occurredOn: '2026-10-18',
  origin: 'Home',
  destination: 'Clinic',
  cost: 32.9,
  ...overrides,
});

/** 5.899 R$/L at 12.5 km/L: 0.4719 R$/km once copied. */
const activeVehicle = {
  active: true,
  fuelPrice: decimal('5.899'),
  avgConsumptionKmL: decimal('12.5'),
};

const error = (kind: ErrorKind, code: ErrorCode) =>
  ({ kind, code }) satisfies Partial<DomainError>;

describe('TripsService', () => {
  const tx = { tx: true };
  let repository: {
    transaction: jest.Mock;
    findPage: jest.Mock;
    findById: jest.Mock;
    findAnyById: jest.Mock;
    findVehicle: jest.Mock;
    findAppointment: jest.Mock;
    clientExists: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    softDelete: jest.Mock;
  };
  let financialEntries: { recordTrip: jest.Mock; removeTripEntry: jest.Mock };
  let service: TripsService;

  /** The columns the service handed to `create` or `update`. */
  const created = (call = 0) =>
    (repository.create.mock.calls[call] as [Trip, unknown])[0];
  const updated = () =>
    (repository.update.mock.calls[0] as [string, Trip, unknown])[1];

  beforeEach(() => {
    repository = {
      // The callback gets a stand-in client, so the specs can check every
      // read and write of a request goes through the same transaction.
      transaction: jest.fn((fn: (client: unknown) => unknown) => fn(tx)),
      findPage: jest.fn(),
      findById: jest.fn().mockResolvedValue(trip()),
      findAnyById: jest.fn().mockResolvedValue(null),
      findVehicle: jest.fn().mockResolvedValue(activeVehicle),
      findAppointment: jest.fn().mockResolvedValue({ clientId: 'client-1' }),
      clientExists: jest.fn().mockResolvedValue(true),
      create: jest.fn((data: Partial<Trip>) =>
        Promise.resolve(trip({ ...data, id: data.id ?? 'trip-1' })),
      ),
      update: jest.fn((id: string, data: Partial<Trip>) =>
        Promise.resolve(trip({ ...data, id })),
      ),
      softDelete: jest.fn().mockResolvedValue(trip({ deletedAt: new Date() })),
    };
    financialEntries = {
      recordTrip: jest.fn().mockResolvedValue(undefined),
      removeTripEntry: jest.fn().mockResolvedValue(undefined),
    };
    service = new TripsService(repository as never, financialEntries as never);
  });

  describe('every response', () => {
    it.each([
      [
        'create',
        async () => (await service.createWithResult('user-1', ownDto())).trip,
      ],
      ['findOne', () => service.findOne('trip-1', 'user-1')],
      ['update', () => service.update('trip-1', 'user-1', {})],
      ['remove', () => service.remove('trip-1', 'user-1')],
    ])(
      '%s has no owner or deletion fields and a plain date',
      async (_name, call) => {
        const result = await call();

        expect(result).not.toHaveProperty('userId');
        expect(result).not.toHaveProperty('deletedAt');
        expect(result.occurredOn).toBe('2026-10-18');
      },
    );
  });

  describe('create', () => {
    it('prices OWN_VEHICLE from the vehicle and copies its cost per km', async () => {
      const { created } = await service.createWithResult('user-1', ownDto());

      expect(created).toBe(true);
      expect(repository.findVehicle).toHaveBeenCalledWith(
        'vehicle-1',
        'user-1',
        tx,
      );
      const [data, client] = repository.create.mock.calls[0] as [Trip, unknown];
      expect(client).toBe(tx);
      expect(data).toMatchObject({
        userId: 'user-1',
        mode: TripMode.OWN_VEHICLE,
        vehicleId: 'vehicle-1',
        occurredOn: new Date('2026-10-18T00:00:00.000Z'),
      });
      expect(data.costPerKm?.toString()).toBe('0.4719');
      expect(data.cost.toString()).toBe('141.57');
    });

    it('stores the fare of a RIDE, with or without a distance', async () => {
      await service.createWithResult('user-1', rideDto());
      await service.createWithResult('user-1', rideDto({ distanceKm: 12.4 }));

      const first = created(0);
      const second = created(1);
      expect(first).toMatchObject({
        vehicleId: null,
        costPerKm: null,
        distanceKm: null,
      });
      expect(first.cost.toString()).toBe('32.9');
      expect(second.distanceKm?.toString()).toBe('12.4');
      expect(repository.findVehicle).not.toHaveBeenCalled();
    });

    it.each([
      [
        'a cost on OWN_VEHICLE',
        ownDto({ cost: 10 }),
        { missing: [], notAllowed: ['cost'] },
      ],
      [
        'OWN_VEHICLE without a vehicle',
        ownDto({ vehicleId: undefined }),
        { missing: ['vehicleId'], notAllowed: [] },
      ],
      [
        'OWN_VEHICLE without a distance',
        ownDto({ distanceKm: undefined }),
        { missing: ['distanceKm'], notAllowed: [] },
      ],
      [
        'RIDE without the fare',
        rideDto({ cost: undefined }),
        { missing: ['cost'], notAllowed: [] },
      ],
      [
        'RIDE with a vehicle',
        rideDto({ vehicleId: 'vehicle-1' }),
        { missing: [], notAllowed: ['vehicleId'] },
      ],
    ])(
      'refuses %s before touching the database',
      async (_case, dto, fields) => {
        await expect(
          service.createWithResult('user-1', dto),
        ).rejects.toMatchObject({
          ...error('INVALID_INPUT', 'TRIP_MODE_FIELDS_INVALID'),
          details: { mode: dto.mode, ...fields },
        });
        expect(repository.transaction).not.toHaveBeenCalled();
      },
    );

    it('refuses an inactive vehicle', async () => {
      repository.findVehicle.mockResolvedValue({
        ...activeVehicle,
        active: false,
      });

      await expect(
        service.createWithResult('user-1', ownDto()),
      ).rejects.toMatchObject(
        error('INVALID_REFERENCE', 'TRIP_VEHICLE_INACTIVE'),
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('refuses a vehicle of another account, or a deleted one', async () => {
      repository.findVehicle.mockResolvedValue(null);

      await expect(
        service.createWithResult('user-1', ownDto()),
      ).rejects.toMatchObject(error('INVALID_REFERENCE', 'VEHICLE_NOT_FOUND'));
    });

    it('records a trip with neither an appointment nor a client', async () => {
      await service.createWithResult('user-1', rideDto());

      expect(repository.findAppointment).not.toHaveBeenCalled();
      expect(repository.clientExists).not.toHaveBeenCalled();
      expect(created()).toMatchObject({ appointmentId: null, clientId: null });
    });

    it('records a trip with a client and no appointment', async () => {
      await service.createWithResult(
        'user-1',
        rideDto({ clientId: 'client-2' }),
      );

      expect(repository.findAppointment).not.toHaveBeenCalled();
      expect(repository.clientExists).toHaveBeenCalledWith(
        'client-2',
        'user-1',
        tx,
      );
      expect(created()).toMatchObject({
        appointmentId: null,
        clientId: 'client-2',
      });
    });

    it('fills the client in from the appointment', async () => {
      await service.createWithResult(
        'user-1',
        rideDto({ appointmentId: 'appointment-1' }),
      );

      expect(repository.findAppointment).toHaveBeenCalledWith(
        'appointment-1',
        'user-1',
        tx,
      );
      expect(created()).toMatchObject({
        appointmentId: 'appointment-1',
        clientId: 'client-1',
      });
    });

    it('accepts the appointment’s own client sent alongside it', async () => {
      await service.createWithResult(
        'user-1',
        rideDto({ appointmentId: 'appointment-1', clientId: 'client-1' }),
      );

      expect(created()).toMatchObject({
        clientId: 'client-1',
      });
    });

    it('refuses a client that is not the appointment’s', async () => {
      await expect(
        service.createWithResult(
          'user-1',
          rideDto({ appointmentId: 'appointment-1', clientId: 'client-2' }),
        ),
      ).rejects.toMatchObject({
        ...error('INVALID_REFERENCE', 'TRIP_CLIENT_MISMATCH'),
        details: { clientId: 'client-2', appointmentClientId: 'client-1' },
      });
    });

    it('takes any client when the appointment has none', async () => {
      repository.findAppointment.mockResolvedValue({ clientId: null });

      await service.createWithResult(
        'user-1',
        rideDto({ appointmentId: 'appointment-1', clientId: 'client-2' }),
      );

      expect(created()).toMatchObject({
        clientId: 'client-2',
      });
    });

    it.each([
      [
        'an appointment',
        { appointmentId: 'appointment-9' },
        'findAppointment',
        'APPOINTMENT_NOT_FOUND',
      ],
      [
        'a client',
        { clientId: 'client-9' },
        'clientExists',
        'CLIENT_NOT_FOUND',
      ],
    ] as const)(
      'refuses %s of another account, or a deleted one',
      async (_case, overrides, method, code) => {
        repository[method].mockResolvedValue(
          method === 'clientExists' ? false : null,
        );

        await expect(
          service.createWithResult('user-1', rideDto(overrides)),
        ).rejects.toMatchObject(error('INVALID_REFERENCE', code));
      },
    );

    describe('with a device id', () => {
      it('creates the trip with that id', async () => {
        const { trip: response } = await service.createWithResult(
          'user-1',
          rideDto({ id: 'device-id' }),
        );

        expect(repository.findAnyById).toHaveBeenCalledWith('device-id', tx);
        expect(created()).toMatchObject({ id: 'device-id' });
        expect(response.id).toBe('device-id');
      });

      it('answers with the stored trip when the same one is resent', async () => {
        repository.findAnyById.mockResolvedValue(rideTrip({ id: 'device-id' }));

        const result = await service.createWithResult(
          'user-1',
          rideDto({ id: 'device-id' }),
        );

        expect(result.created).toBe(false);
        expect(result.trip.id).toBe('device-id');
        expect(repository.create).not.toHaveBeenCalled();
      });

      it('answers with the stored OWN_VEHICLE trip even if its vehicle is inactive now', async () => {
        repository.findAnyById.mockResolvedValue(trip({ id: 'device-id' }));
        repository.findVehicle.mockResolvedValue({
          ...activeVehicle,
          active: false,
        });

        const result = await service.createWithResult(
          'user-1',
          ownDto({ id: 'device-id' }),
        );

        expect(result.created).toBe(false);
        expect(repository.findVehicle).not.toHaveBeenCalled();
      });

      it.each([
        [
          'different content',
          rideTrip({ id: 'device-id', destination: 'Office' }),
        ],
        ['another account', rideTrip({ id: 'device-id', userId: 'user-2' })],
        [
          'a deleted trip',
          rideTrip({ id: 'device-id', deletedAt: new Date() }),
        ],
      ])('refuses an id already used by %s', async (_case, stored) => {
        repository.findAnyById.mockResolvedValue(stored);

        await expect(
          service.createWithResult('user-1', rideDto({ id: 'device-id' })),
        ).rejects.toMatchObject({
          ...error('CONFLICT', 'TRIP_ID_CONFLICT'),
          details: { id: 'device-id' },
        });
        expect(repository.create).not.toHaveBeenCalled();
      });

      it('settles a race on the same id by comparing with the winner', async () => {
        repository.create.mockRejectedValue(new UniqueConstraintError(['id']));
        repository.findAnyById
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(rideTrip({ id: 'device-id' }));

        const result = await service.createWithResult(
          'user-1',
          rideDto({ id: 'device-id' }),
        );

        expect(result.created).toBe(false);
      });
    });
  });

  describe('update', () => {
    it('reprices a new distance with the copied cost per km, not the vehicle’s current one', async () => {
      // The fuel price changed since the trip was recorded.
      repository.findVehicle.mockResolvedValue({
        ...activeVehicle,
        fuelPrice: decimal('7.5'),
      });

      await service.update('trip-1', 'user-1', { distanceKm: 100 });

      expect(repository.findVehicle).not.toHaveBeenCalled();
      const [, data, client] = repository.update.mock.calls[0] as [
        string,
        Trip,
        unknown,
      ];
      expect(client).toBe(tx);
      expect(data.costPerKm?.toString()).toBe('0.4719');
      expect(data.cost.toString()).toBe('47.19');
    });

    it('edits a trip whose vehicle was inactivated since', async () => {
      repository.findVehicle.mockResolvedValue({
        ...activeVehicle,
        active: false,
      });

      await expect(
        service.update('trip-1', 'user-1', { origin: 'Office' }),
      ).resolves.toMatchObject({ origin: 'Office' });
    });

    it('copies the current cost per km of a vehicle it switches to', async () => {
      repository.findVehicle.mockResolvedValue({
        active: true,
        fuelPrice: decimal('6.29'),
        avgConsumptionKmL: decimal('10'),
      });

      await service.update('trip-1', 'user-1', {
        vehicleId: 'vehicle-2',
        distanceKm: 100,
      });

      expect(repository.findVehicle).toHaveBeenCalledWith(
        'vehicle-2',
        'user-1',
        tx,
      );
      const data = updated();
      expect(data.costPerKm?.toString()).toBe('0.629');
      expect(data.cost.toString()).toBe('62.9');
    });

    it('refuses switching to an inactive vehicle', async () => {
      repository.findVehicle.mockResolvedValue({
        ...activeVehicle,
        active: false,
      });

      await expect(
        service.update('trip-1', 'user-1', { vehicleId: 'vehicle-2' }),
      ).rejects.toMatchObject(
        error('INVALID_REFERENCE', 'TRIP_VEHICLE_INACTIVE'),
      );
    });

    it('switches OWN_VEHICLE to RIDE, dropping the vehicle and keeping the distance', async () => {
      await service.update('trip-1', 'user-1', {
        mode: TripMode.RIDE,
        cost: 50,
      });

      const data = updated();
      expect(data).toMatchObject({
        mode: TripMode.RIDE,
        vehicleId: null,
        costPerKm: null,
      });
      expect(data.cost.toString()).toBe('50');
      expect(data.distanceKm?.toString()).toBe('300');
    });

    it('switches RIDE to OWN_VEHICLE, pricing it from the vehicle', async () => {
      repository.findById.mockResolvedValue(
        rideTrip({ distanceKm: decimal('30') }),
      );

      await service.update('trip-1', 'user-1', {
        mode: TripMode.OWN_VEHICLE,
        vehicleId: 'vehicle-1',
      });

      const data = updated();
      expect(data).toMatchObject({
        mode: TripMode.OWN_VEHICLE,
        vehicleId: 'vehicle-1',
      });
      expect(data.cost.toString()).toBe('14.16');
    });

    it.each([
      [
        'switching to RIDE without a fare',
        trip(),
        { mode: TripMode.RIDE },
        { missing: ['cost'], notAllowed: [] },
      ],
      [
        'switching to OWN_VEHICLE without a vehicle',
        rideTrip({ distanceKm: decimal('30') }),
        { mode: TripMode.OWN_VEHICLE },
        { missing: ['vehicleId'], notAllowed: [] },
      ],
      [
        'sending a cost to OWN_VEHICLE',
        trip(),
        { cost: 10 },
        { missing: [], notAllowed: ['cost'] },
      ],
      [
        'clearing the distance of OWN_VEHICLE',
        trip(),
        { distanceKm: null },
        { missing: ['distanceKm'], notAllowed: [] },
      ],
      [
        'clearing the fare of a RIDE',
        rideTrip(),
        { cost: null },
        { missing: ['cost'], notAllowed: [] },
      ],
    ])(
      'checks the merged trip: refuses %s',
      async (_case, stored, dto, fields) => {
        repository.findById.mockResolvedValue(stored);

        await expect(
          service.update('trip-1', 'user-1', dto),
        ).rejects.toMatchObject({
          ...error('INVALID_INPUT', 'TRIP_MODE_FIELDS_INVALID'),
          details: fields,
        });
        expect(repository.update).not.toHaveBeenCalled();
      },
    );

    it('keeps the fare of a RIDE when only the date changes', async () => {
      repository.findById.mockResolvedValue(rideTrip());

      await service.update('trip-1', 'user-1', { occurredOn: '2026-10-17' });

      const data = updated();
      expect(data.cost.toString()).toBe('32.9');
      expect(data.occurredOn).toEqual(new Date('2026-10-17T00:00:00.000Z'));
    });

    it('keeps the client when nothing about it changes', async () => {
      repository.findById.mockResolvedValue(rideTrip({ clientId: 'client-1' }));

      await service.update('trip-1', 'user-1', { origin: 'Office' });

      expect(repository.findAppointment).not.toHaveBeenCalled();
      expect(repository.clientExists).not.toHaveBeenCalled();
      expect(updated()).toMatchObject({
        clientId: 'client-1',
      });
    });

    it('takes the client of a newly linked appointment', async () => {
      repository.findById.mockResolvedValue(rideTrip({ clientId: 'client-9' }));

      await service.update('trip-1', 'user-1', {
        appointmentId: 'appointment-1',
      });

      expect(updated()).toMatchObject({
        appointmentId: 'appointment-1',
        clientId: 'client-1',
      });
    });

    it('clears the client with null', async () => {
      repository.findById.mockResolvedValue(rideTrip({ clientId: 'client-1' }));

      await service.update('trip-1', 'user-1', { clientId: null });

      expect(updated()).toMatchObject({
        clientId: null,
      });
    });

    it('reports a trip of another account, or a deleted one, as not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.update('trip-1', 'user-2', {}),
      ).rejects.toMatchObject(error('NOT_FOUND', 'TRIP_NOT_FOUND'));
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    beforeEach(() => {
      repository.findPage.mockResolvedValue({
        trips: [trip(), rideTrip({ id: 'trip-2' })],
        total: 7,
        totalKm: decimal('612.4'),
        totalCost: decimal('1234.5'),
      });
    });

    it('returns the page with the totals of the whole period', async () => {
      const result = await service.findAll('user-1', {
        from: '2026-10-01',
        to: '2026-10-31',
        page: 2,
        pageSize: 2,
      });

      expect(repository.findPage).toHaveBeenCalledWith(
        'user-1',
        {
          from: new Date('2026-10-01T00:00:00.000Z'),
          to: new Date('2026-10-31T00:00:00.000Z'),
        },
        2,
        2,
      );
      expect(result).toMatchObject({
        total: 7,
        page: 2,
        pageSize: 2,
        totalKm: '612.40',
        totalCost: '1234.50',
      });
      expect(result.items.map(item => item.id)).toEqual(['trip-1', 'trip-2']);
    });

    it('lists every trip when no period is given', async () => {
      await service.findAll('user-1', { page: 1, pageSize: 20 });

      expect(repository.findPage).toHaveBeenCalledWith('user-1', {}, 0, 20);
    });

    it('takes a period of a single day', async () => {
      await expect(
        service.findAll('user-1', {
          from: '2026-10-18',
          to: '2026-10-18',
          page: 1,
          pageSize: 20,
        }),
      ).resolves.toBeDefined();
    });

    it('refuses a period that ends before it starts', async () => {
      await expect(
        service.findAll('user-1', {
          from: '2026-10-19',
          to: '2026-10-18',
          page: 1,
          pageSize: 20,
        }),
      ).rejects.toMatchObject(error('INVALID_INPUT', 'INVALID_REQUEST'));
      expect(repository.findPage).not.toHaveBeenCalled();
    });
  });

  describe('findOne and remove', () => {
    it('reports a missing, deleted or another account’s trip as not found', async () => {
      repository.findById.mockResolvedValue(null);
      repository.softDelete.mockResolvedValue(null);

      await expect(service.findOne('trip-1', 'user-2')).rejects.toMatchObject(
        error('NOT_FOUND', 'TRIP_NOT_FOUND'),
      );
      await expect(service.remove('trip-1', 'user-2')).rejects.toMatchObject(
        error('NOT_FOUND', 'TRIP_NOT_FOUND'),
      );
    });

    it('soft-deletes inside a transaction', async () => {
      await service.remove('trip-1', 'user-1');

      expect(repository.softDelete).toHaveBeenCalledWith(
        'trip-1',
        'user-1',
        tx,
      );
    });
  });

  describe('the expense', () => {
    const posted = () =>
      financialEntries.recordTrip.mock.calls[0] as [
        {
          userId: string;
          tripId: string;
          amount: Prisma.Decimal;
          occurredOn: Date;
          description: string;
        },
        unknown,
      ];

    it('is posted with the new trip, in its transaction', async () => {
      await service.createWithResult('user-1', ownDto());

      const [input, client] = posted();
      expect(client).toBe(tx);
      expect(input).toMatchObject({
        userId: 'user-1',
        tripId: 'trip-1',
        occurredOn: new Date('2026-10-18T00:00:00.000Z'),
        description: 'Home → Clinic',
      });
      expect(input.amount.toString()).toBe('141.57');
    });

    it('follows an edited trip, in its transaction', async () => {
      await service.update('trip-1', 'user-1', {
        distanceKm: 100,
        destination: 'Office',
      });

      const [input, client] = posted();
      expect(client).toBe(tx);
      expect(input.amount.toString()).toBe('47.19');
      expect(input.description).toBe('Home → Office');
    });

    it('is handed a zero cost as it is, for the financial module to drop', async () => {
      await service.update('trip-1', 'user-1', { distanceKm: 0.01 });

      expect(posted()[0].amount.toString()).toBe('0');
    });

    it('is left alone when a trip is resent with its device id', async () => {
      repository.findAnyById.mockResolvedValue(rideTrip({ id: 'device-id' }));

      await service.createWithResult('user-1', rideDto({ id: 'device-id' }));

      expect(financialEntries.recordTrip).not.toHaveBeenCalled();
    });

    it('is left alone when the trip is refused', async () => {
      await expect(
        service.createWithResult('user-1', ownDto({ cost: 10 })),
      ).rejects.toBeInstanceOf(DomainError);
      repository.findById.mockResolvedValue(null);
      await expect(
        service.update('trip-1', 'user-2', { distanceKm: 10 }),
      ).rejects.toBeInstanceOf(DomainError);

      expect(financialEntries.recordTrip).not.toHaveBeenCalled();
    });

    it('fails the request when it cannot be posted, so the trip is not kept', async () => {
      financialEntries.recordTrip.mockRejectedValue(
        new DomainError(
          'INVALID_INPUT',
          'FINANCIAL_CATEGORY_NOT_SEEDED',
          'Travel category is not seeded',
        ),
      );

      await expect(
        service.createWithResult('user-1', ownDto()),
      ).rejects.toMatchObject(
        error('INVALID_INPUT', 'FINANCIAL_CATEGORY_NOT_SEEDED'),
      );
    });

    it('is removed with the deleted trip, in its transaction', async () => {
      await service.remove('trip-1', 'user-1');

      expect(financialEntries.removeTripEntry).toHaveBeenCalledWith(
        'user-1',
        'trip-1',
        tx,
      );
    });

    it('is left alone when the trip to delete is not found', async () => {
      repository.softDelete.mockResolvedValue(null);

      await expect(service.remove('trip-1', 'user-2')).rejects.toBeInstanceOf(
        DomainError,
      );
      expect(financialEntries.removeTripEntry).not.toHaveBeenCalled();
    });
  });
});
