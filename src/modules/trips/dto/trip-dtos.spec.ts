import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateTripDto } from './create-trip.dto';
import { QueryTripDto } from './query-trip.dto';
import { UpdateTripDto } from './update-trip.dto';

const UUID = '6f1c1e44-5a1d-4f0e-9b7b-2f5d6f3a9c11';

const VALID = {
  mode: 'OWN_VEHICLE',
  vehicleId: UUID,
  occurredOn: '2026-10-18',
  origin: 'Home',
  destination: 'Clinic',
  distanceKm: 30,
};

async function check<T extends object>(
  cls: new () => T,
  body: Record<string, unknown>,
) {
  const dto = plainToInstance(cls, body);
  const errors = await validate(dto);
  return { dto, failing: errors.map(error => error.property) };
}

describe('CreateTripDto', () => {
  it('accepts a complete trip', async () => {
    expect((await check(CreateTripDto, VALID)).failing).toEqual([]);
  });

  it.each(['mode', 'occurredOn', 'origin', 'destination'])(
    'requires %s',
    async field => {
      const body: Record<string, unknown> = { ...VALID };
      delete body[field];

      expect((await check(CreateTripDto, body)).failing).toEqual([field]);
    },
  );

  // Which of these a mode needs is the service's call, against the whole trip.
  it.each(['vehicleId', 'distanceKm'])(
    'leaves %s to the mode rules',
    async field => {
      const body: Record<string, unknown> = { ...VALID };
      delete body[field];

      expect((await check(CreateTripDto, body)).failing).toEqual([]);
    },
  );

  it.each(['origin', 'destination'])(
    'trims %s before storing it',
    async field => {
      const { dto, failing } = await check(CreateTripDto, {
        ...VALID,
        [field]: '  Clinic  ',
      });

      expect(failing).toEqual([]);
      expect(dto[field as keyof CreateTripDto]).toBe('Clinic');
    },
  );

  it.each([
    ['origin', '   '],
    ['origin', ''],
    ['origin', 42],
    ['origin', 'x'.repeat(201)],
    ['destination', '\t\n'],
    ['destination', null],
    ['mode', 'BICYCLE'],
    ['occurredOn', '2027-02-30'],
    ['occurredOn', '20271018'],
    ['occurredOn', '2026-10-18T10:00:00Z'],
    ['distanceKm', 0],
    ['distanceKm', -1],
    ['distanceKm', 30.555],
    ['distanceKm', 5000.01],
    ['distanceKm', '30'],
    ['cost', 0],
    ['cost', 10.555],
    ['cost', 10000.01],
    ['id', 'not-a-uuid'],
    ['vehicleId', 'not-a-uuid'],
    ['appointmentId', 'not-a-uuid'],
    ['clientId', 'not-a-uuid'],
  ])('refuses %s = %j', async (field, value) => {
    expect(
      (await check(CreateTripDto, { ...VALID, [field]: value })).failing,
    ).toEqual([field]);
  });

  it.each([
    ['origin', 'x'.repeat(200)],
    ['origin', ` ${'x'.repeat(200)} `],
    ['distanceKm', 0.01],
    ['distanceKm', 5000],
    ['cost', 10000],
    ['id', UUID],
    ['appointmentId', UUID],
    ['clientId', UUID],
  ])('accepts %s = %j', async (field, value) => {
    expect(
      (await check(CreateTripDto, { ...VALID, [field]: value })).failing,
    ).toEqual([]);
  });
});

describe('UpdateTripDto', () => {
  it('accepts an empty patch', async () => {
    expect((await check(UpdateTripDto, {})).failing).toEqual([]);
  });

  it.each(['mode', 'occurredOn', 'origin', 'destination'])(
    'refuses null for the required %s',
    async field => {
      expect((await check(UpdateTripDto, { [field]: null })).failing).toEqual([
        field,
      ]);
    },
  );

  it.each(['vehicleId', 'appointmentId', 'clientId', 'distanceKm', 'cost'])(
    'accepts null to clear %s',
    async field => {
      expect((await check(UpdateTripDto, { [field]: null })).failing).toEqual(
        [],
      );
    },
  );

  it('keeps the create rules for what it receives', async () => {
    const { dto, failing } = await check(UpdateTripDto, {
      origin: '  Office  ',
      distanceKm: 0,
    });

    expect(failing).toEqual(['distanceKm']);
    expect(dto.origin).toBe('Office');
  });

  it('does not take an id', async () => {
    // The options of the global ValidationPipe, which refuses unknown fields.
    const errors = await validate(
      plainToInstance(UpdateTripDto, { id: UUID }),
      {
        whitelist: true,
        forbidNonWhitelisted: true,
      },
    );

    expect(errors.map(error => error.property)).toEqual(['id']);
  });
});

describe('QueryTripDto', () => {
  it('pages from the first page, 20 at a time, without a period', async () => {
    const { dto, failing } = await check(QueryTripDto, {});

    expect(failing).toEqual([]);
    expect(dto).toMatchObject({ page: 1, pageSize: 20 });
    expect(dto.from).toBeUndefined();
    expect(dto.to).toBeUndefined();
  });

  it('reads page numbers from the query string', async () => {
    expect(
      (await check(QueryTripDto, { page: '2', pageSize: '50' })).dto,
    ).toMatchObject({ page: 2, pageSize: 50 });
  });

  it.each([
    ['from', '2027-02-30'],
    ['to', '18/10/2026'],
    ['page', '0'],
    ['pageSize', '101'],
    ['pageSize', 'abc'],
  ])('refuses %s = %j', async (field, value) => {
    expect((await check(QueryTripDto, { [field]: value })).failing).toEqual([
      field,
    ]);
  });
});
