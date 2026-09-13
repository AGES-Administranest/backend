import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { IsNotBefore } from './is-not-before.decorator';

class Period {
  startDate?: string;

  @IsNotBefore('startDate')
  endDate?: string;
}

async function invalidFields(raw: Partial<Period>): Promise<string[]> {
  const errors = await validate(plainToInstance(Period, raw));
  return errors.map(error => error.property);
}

describe('@IsNotBefore', () => {
  it('accepts an end after the start', async () => {
    expect(
      await invalidFields({ startDate: '2026-09-01', endDate: '2026-09-30' }),
    ).toEqual([]);
  });

  it('accepts an end equal to the start', async () => {
    const stamp = '2026-09-01T10:00:00.000Z';

    expect(await invalidFields({ startDate: stamp, endDate: stamp })).toEqual(
      [],
    );
  });

  it('rejects an end before the start, naming the end field', async () => {
    expect(
      await invalidFields({ startDate: '2026-09-30', endDate: '2026-09-01' }),
    ).toEqual(['endDate']);
  });

  it('reads a plain end date as the whole day, so the same day as a timed start is fine', async () => {
    expect(
      await invalidFields({
        startDate: '2026-09-01T10:00:00.000Z',
        endDate: '2026-09-01',
      }),
    ).toEqual([]);
  });

  it('carries a readable message for the details.fields of the 400', async () => {
    const [error] = await validate(
      plainToInstance(Period, {
        startDate: '2026-09-30',
        endDate: '2026-09-01',
      }),
    );

    expect(Object.values(error.constraints ?? {})).toEqual([
      'endDate must not be before startDate',
    ]);
  });

  it.each([
    ['no start', { endDate: '2026-09-01' }],
    ['no end', { startDate: '2026-09-01' }],
    ['an unparseable start', { startDate: 'yesterday', endDate: '2026-09-01' }],
    ['an unparseable end', { startDate: '2026-09-01', endDate: 'tomorrow' }],
  ])(
    'stays out of the way with %s (other validators own that)',
    async (_, raw) => {
      expect(await invalidFields(raw)).toEqual([]);
    },
  );
});
