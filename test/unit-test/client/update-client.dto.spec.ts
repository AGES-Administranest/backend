import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateClientDto } from '../../../src/modules/client/dto/update-client.dto';

const TOGETHER =
  'taxId and taxIdType must be sent together: both set, or both null to remove the tax id';

// Same options as the global ValidationPipe in src/main.ts.
const messagesFor = async (body: Record<string, unknown>) => {
  const errors = await validate(plainToInstance(UpdateClientDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.flatMap(error => Object.values(error.constraints ?? {}));
};

describe('UpdateClientDto — tax id', () => {
  it('accepts an update that does not touch the tax id', async () => {
    expect(await messagesFor({ city: 'Canoas' })).toEqual([]);
  });

  it('accepts a new CPF sent with its type', async () => {
    expect(
      await messagesFor({ taxId: '12345678901', taxIdType: 'CPF' }),
    ).toEqual([]);
  });

  it('accepts removing the tax id by sending both fields as null', async () => {
    expect(await messagesFor({ taxId: null, taxIdType: null })).toEqual([]);
  });

  // The cases PartialType alone would let through: each field is optional on
  // its own there, so the pair check never runs when taxId itself is missing.
  it.each([
    ['taxIdType on its own', { taxIdType: 'CPF' }],
    ['taxId null on its own', { taxId: null }],
    ['taxIdType null on its own', { taxIdType: null }],
    ['taxId on its own', { taxId: '12345678901' }],
    ['a type with a null number', { taxId: null, taxIdType: 'CNPJ' }],
  ])('rejects %s', async (_case, body) => {
    expect(await messagesFor(body)).toEqual([TOGETHER]);
  });

  it('rejects a CNPJ in the wrong format', async () => {
    expect(
      await messagesFor({ taxId: '12.345.678/0001-90', taxIdType: 'CNPJ' }),
    ).toEqual([
      'taxId must have exactly 14 digits, with no punctuation, when taxIdType is CNPJ',
    ]);
  });

  it('still validates the other inherited fields', async () => {
    expect(await messagesFor({ name: 'V' })).toEqual([
      'name must be longer than or equal to 2 characters',
    ]);
  });
});
