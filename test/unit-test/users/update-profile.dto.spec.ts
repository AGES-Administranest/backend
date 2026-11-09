import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  isPlausibleBirthDate,
  UpdateProfileDto,
} from '../../../src/modules/users/dto/update-profile.dto';
import { toIsoDate } from '../../../src/shared/dates/iso-date';

const VALID = {
  name: 'Ana Souza',
  crmv: 'RS-12345',
  birthDate: '1990-04-15',
  sex: 'FEMALE',
  city: 'Porto Alegre',
  state: 'RS',
};

async function check(body: Record<string, unknown>) {
  const dto = plainToInstance(UpdateProfileDto, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, failing: errors.map(error => error.property) };
}

function yearsAgo(years: number, extraDays = 0): string {
  const today = new Date();
  return toIsoDate(
    new Date(
      Date.UTC(
        today.getUTCFullYear() - years,
        today.getUTCMonth(),
        today.getUTCDate() + extraDays,
      ),
    ),
  );
}

describe('UpdateProfileDto', () => {
  it('accepts a complete profile', async () => {
    expect((await check(VALID)).failing).toEqual([]);
  });

  it('accepts an empty body', async () => {
    expect((await check({})).failing).toEqual([]);
  });

  it.each(Object.keys(VALID))('accepts %s alone', async field => {
    expect(
      (await check({ [field]: VALID[field as keyof typeof VALID] })).failing,
    ).toEqual([]);
  });

  it.each(['crmv', 'birthDate', 'sex', 'city', 'state'])(
    'accepts %s = null to clear it',
    async field => {
      expect((await check({ [field]: null })).failing).toEqual([]);
    },
  );

  it('refuses name = null', async () => {
    expect((await check({ name: null })).failing).toEqual(['name']);
  });

  it.each(['email', 'cognitoSub', 'taxId', 'photoUrl', 'id'])(
    'refuses the non-editable field %s',
    async field => {
      expect((await check({ [field]: 'x' })).failing).toEqual([field]);
    },
  );

  it.each([
    ['a', false],
    ['ab', true],
    ['a'.repeat(120), true],
    ['a'.repeat(121), false],
    ['   ', false],
    [' a ', false],
  ])('name %j passes: %s', async (name, passes) => {
    expect((await check({ name })).failing).toEqual(passes ? [] : ['name']);
  });

  it('trims the name', async () => {
    const { dto, failing } = await check({ name: '  Ana  ' });

    expect(failing).toEqual([]);
    expect(dto.name).toBe('Ana');
  });

  it.each(['RS-1', 'SP-123456', 'DF-42'])('accepts crmv %s', async crmv => {
    expect((await check({ crmv })).failing).toEqual([]);
  });

  it.each([
    '12345',
    'RS12345',
    'XX-12345',
    'RS-',
    'RS-1234567',
    'RS-12a45',
    '',
  ])('refuses crmv %j', async crmv => {
    expect((await check({ crmv })).failing).toEqual(['crmv']);
  });

  it('normalizes the crmv to upper case', async () => {
    const { dto, failing } = await check({ crmv: ' rs-12345 ' });

    expect(failing).toEqual([]);
    expect(dto.crmv).toBe('RS-12345');
  });

  it.each(['AC', 'DF', 'RS', 'SP', 'TO'])('accepts state %s', async state => {
    expect((await check({ state })).failing).toEqual([]);
  });

  it.each(['XX', 'R', 'RSS', '', 42])('refuses state %j', async state => {
    expect((await check({ state })).failing).toEqual(['state']);
  });

  it('normalizes the state to upper case', async () => {
    const { dto, failing } = await check({ state: 'rs' });

    expect(failing).toEqual([]);
    expect(dto.state).toBe('RS');
  });

  it.each([
    yearsAgo(0),
    yearsAgo(0, 1),
    yearsAgo(10),
    yearsAgo(18, 1),
    '1899-12-31',
    '1990-02-30',
    '19900415',
    '1990-04-15T00:00:00Z',
  ])('refuses birthDate %s', async birthDate => {
    expect((await check({ birthDate })).failing).toEqual(['birthDate']);
  });

  it.each([yearsAgo(18), '1900-01-01', '1990-04-15'])(
    'accepts birthDate %s',
    async birthDate => {
      expect((await check({ birthDate })).failing).toEqual([]);
    },
  );

  it.each(['FEMALE', 'MALE', 'OTHER', 'NOT_INFORMED'])(
    'accepts sex %s',
    async sex => {
      expect((await check({ sex })).failing).toEqual([]);
    },
  );

  it.each(['female', 'X', ''])('refuses sex %j', async sex => {
    expect((await check({ sex })).failing).toEqual(['sex']);
  });

  it.each([
    ['   ', false],
    ['a'.repeat(120), true],
    ['a'.repeat(121), false],
  ])('city %j passes: %s', async (city, passes) => {
    expect((await check({ city })).failing).toEqual(passes ? [] : ['city']);
  });
});

describe('isPlausibleBirthDate', () => {
  const today = new Date('2026-11-09T15:00:00.000Z');

  it.each([
    ['2008-11-09', true],
    ['2008-11-10', false],
    ['1900-01-01', true],
    ['1899-12-31', false],
  ])('%s passes: %s', (isoDate, passes) => {
    expect(
      isPlausibleBirthDate(new Date(`${isoDate}T00:00:00.000Z`), today),
    ).toBe(passes);
  });
});
