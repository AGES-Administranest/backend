import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ProcedureEstimateDto } from './procedure-estimate.dto';

const UUID = '6f1c1e44-5a1d-4f0e-9b7b-2f5d6f3a9c11';

async function failing(body: Record<string, unknown>) {
  const errors = await validate(plainToInstance(ProcedureEstimateDto, body));
  return errors.map(error => error.property);
}

const line = (overrides: Record<string, unknown> = {}) => ({
  itemId: UUID,
  quantity: 2,
  ...overrides,
});

describe('ProcedureEstimateDto', () => {
  it('accepts only a duration', async () => {
    expect(await failing({ durationMinutes: 90 })).toEqual([]);
  });

  it('accepts a client and supplies', async () => {
    expect(
      await failing({
        durationMinutes: 90,
        clientId: UUID,
        supplies: [line(), line({ quantity: 0.125 })],
      }),
    ).toEqual([]);
  });

  it.each([
    ['clientId', null],
    ['supplies', []],
    ['durationMinutes', 1],
    ['durationMinutes', 1440],
  ])('accepts %s = %j', async (field, value) => {
    expect(await failing({ durationMinutes: 90, [field]: value })).toEqual([]);
  });

  it.each([
    ['durationMinutes', undefined],
    ['durationMinutes', 0],
    ['durationMinutes', -30],
    ['durationMinutes', 90.5],
    ['durationMinutes', 1441],
    ['durationMinutes', '90'],
    ['clientId', 'not-a-uuid'],
    ['supplies', 'item-1'],
    ['supplies', Array.from({ length: 101 }, () => line())],
  ])('refuses %s = %j', async (field, value) => {
    expect(await failing({ durationMinutes: 90, [field]: value })).toEqual([
      field,
    ]);
  });

  it.each([
    ['itemId', 'not-a-uuid'],
    ['itemId', undefined],
    ['quantity', 0],
    ['quantity', -1],
    ['quantity', 1.2345],
    ['quantity', 10000.001],
    ['quantity', '2'],
  ])('refuses a supply line with %s = %j', async (field, value) => {
    expect(
      await failing({
        durationMinutes: 90,
        supplies: [line({ [field]: value })],
      }),
    ).toEqual(['supplies']);
  });

  it('accepts a quantity at the ceiling', async () => {
    expect(
      await failing({
        durationMinutes: 90,
        supplies: [line({ quantity: 10000 })],
      }),
    ).toEqual([]);
  });
});
