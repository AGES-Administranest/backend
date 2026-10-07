import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateVehicleDto } from './create-vehicle.dto';
import { QueryVehicleDto } from './query-vehicle.dto';
import { UpdateVehicleDto } from './update-vehicle.dto';

const VALID = {
  brand: 'Fiat',
  model: 'Strada',
  fuelType: 'GASOLINE',
  avgConsumptionKmL: 12.5,
  fuelPrice: 5.899,
};

async function check<T extends object>(
  cls: new () => T,
  body: Record<string, unknown>,
) {
  const dto = plainToInstance(cls, body);
  const errors = await validate(dto);
  return { dto, failing: errors.map(error => error.property) };
}

describe('CreateVehicleDto', () => {
  it('accepts a complete vehicle', async () => {
    expect((await check(CreateVehicleDto, VALID)).failing).toEqual([]);
  });

  it.each(Object.keys(VALID))('requires %s', async field => {
    const body: Record<string, unknown> = { ...VALID };
    delete body[field];

    expect((await check(CreateVehicleDto, body)).failing).toEqual([field]);
  });

  it.each(['brand', 'model'])('trims %s before storing it', async field => {
    const { dto, failing } = await check(CreateVehicleDto, {
      ...VALID,
      [field]: '  Fiat  ',
    });

    expect(failing).toEqual([]);
    expect(dto[field as keyof CreateVehicleDto]).toBe('Fiat');
  });

  it.each([
    ['brand', '   '],
    ['brand', ''],
    ['brand', 42],
    ['brand', null],
    ['model', '   '],
    ['model', '\t\n'],
    ['model', 42],
  ])('refuses %s = %j', async (field, value) => {
    expect(
      (await check(CreateVehicleDto, { ...VALID, [field]: value })).failing,
    ).toEqual([field]);
  });

  it.each([
    ['brand', 60, true],
    ['brand', 61, false],
    ['model', 120, true],
    ['model', 121, false],
  ])('%s with %i characters passes: %s', async (field, length, passes) => {
    const { failing } = await check(CreateVehicleDto, {
      ...VALID,
      [field]: 'a'.repeat(length),
    });

    expect(failing).toEqual(passes ? [] : [field]);
  });

  it('counts the length after trimming', async () => {
    const { failing } = await check(CreateVehicleDto, {
      ...VALID,
      brand: `  ${'a'.repeat(60)}  `,
    });

    expect(failing).toEqual([]);
  });

  it.each([
    ['avgConsumptionKmL', 0],
    ['avgConsumptionKmL', -1],
    ['avgConsumptionKmL', 12.555],
    ['avgConsumptionKmL', 100.01],
    ['avgConsumptionKmL', '12.5'],
    ['fuelPrice', 0],
    ['fuelPrice', -5.899],
    ['fuelPrice', 5.8999],
    ['fuelPrice', 100.001],
    ['fuelType', 'FLEX'],
    ['fuelType', 'gasoline'],
  ])('refuses %s = %j', async (field, value) => {
    expect(
      (await check(CreateVehicleDto, { ...VALID, [field]: value })).failing,
    ).toEqual([field]);
  });

  it.each([
    ['avgConsumptionKmL', 0.01],
    ['avgConsumptionKmL', 100],
    ['fuelPrice', 0.001],
    ['fuelPrice', 100],
    ['fuelType', 'ETHANOL'],
    ['fuelType', 'DIESEL'],
  ])('accepts %s = %j', async (field, value) => {
    expect(
      (await check(CreateVehicleDto, { ...VALID, [field]: value })).failing,
    ).toEqual([]);
  });
});

describe('UpdateVehicleDto', () => {
  it('accepts a partial update', async () => {
    expect(
      (await check(UpdateVehicleDto, { fuelPrice: 6.29 })).failing,
    ).toEqual([]);
  });

  it.each([true, false])('accepts active = %s', async active => {
    expect((await check(UpdateVehicleDto, { active })).failing).toEqual([]);
  });

  it.each([
    ['brand', '   '],
    ['model', ''],
    ['fuelPrice', 0],
    ['active', 'true'],
  ])('keeps the create rules: refuses %s = %j', async (field, value) => {
    expect((await check(UpdateVehicleDto, { [field]: value })).failing).toEqual(
      [field],
    );
  });

  // PartialType would let null through and the NOT NULL column would answer 500.
  it.each([
    'brand',
    'model',
    'fuelType',
    'avgConsumptionKmL',
    'fuelPrice',
    'active',
  ])('refuses %s = null', async field => {
    expect((await check(UpdateVehicleDto, { [field]: null })).failing).toEqual([
      field,
    ]);
  });
});

describe('QueryVehicleDto', () => {
  it.each([
    [{}, true],
    [{ active: 'true' }, true],
    [{ active: 'false' }, false],
  ])('%j lists active = %s', async (query, expected) => {
    const { dto, failing } = await check(QueryVehicleDto, query);

    expect(failing).toEqual([]);
    expect(dto.active).toBe(expected);
  });

  it.each(['abc', '1', 'FALSE'])('refuses active = %s', async active => {
    expect((await check(QueryVehicleDto, { active })).failing).toEqual([
      'active',
    ]);
  });
});
