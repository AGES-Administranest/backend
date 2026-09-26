import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateClientDto } from '../../../src/modules/client/dto/create-client.dto';

const TOGETHER =
  'taxId and taxIdType must be sent together: both set, or both null to remove the tax id';

const validPayload = { type: 'CLINIC', name: 'Clínica VetNova' };

// Same options as the global ValidationPipe in src/main.ts.
const messagesFor = async (overrides: Record<string, unknown>) => {
  const dto = plainToInstance(CreateClientDto, {
    ...validPayload,
    ...overrides,
  });
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.flatMap(error => Object.values(error.constraints ?? {}));
};

describe('CreateClientDto — tax id', () => {
  it('accepts a client with no tax id at all', async () => {
    expect(await messagesFor({})).toEqual([]);
  });

  it.each([
    ['a CNPJ with 14 digits', '12345678000190', 'CNPJ'],
    ['a CPF with 11 digits', '12345678901', 'CPF'],
  ])('accepts %s', async (_case, taxId, taxIdType) => {
    expect(await messagesFor({ taxId, taxIdType })).toEqual([]);
  });

  it('accepts both fields as null, the same as leaving them out', async () => {
    expect(await messagesFor({ taxId: null, taxIdType: null })).toEqual([]);
  });

  it.each([
    ['a punctuated CNPJ', '12.345.678/0001-90', 'CNPJ', 14],
    ['a CNPJ with 13 digits', '1234567800019', 'CNPJ', 14],
    ['a CNPJ with 15 digits', '123456780001901', 'CNPJ', 14],
    ['a CPF number sent as a CNPJ', '12345678901', 'CNPJ', 14],
    ['a punctuated CPF', '123.456.789-01', 'CPF', 11],
    ['a CPF with 10 digits', '1234567890', 'CPF', 11],
    ['a CNPJ number sent as a CPF', '12345678000190', 'CPF', 11],
  ])(
    'rejects %s and says how many digits are expected',
    async (_case, taxId, taxIdType, digits) => {
      expect(await messagesFor({ taxId, taxIdType })).toEqual([
        `taxId must have exactly ${digits} digits, with no punctuation, when taxIdType is ${taxIdType}`,
      ]);
    },
  );

  it.each([
    ['taxId without its type', { taxId: '12345678000190' }],
    ['taxIdType without a number', { taxIdType: 'CNPJ' }],
    ['a number with a null type', { taxId: '12345678000190', taxIdType: null }],
  ])('rejects %s', async (_case, overrides) => {
    expect(await messagesFor(overrides)).toEqual([TOGETHER]);
  });

  it('rejects an unknown taxIdType', async () => {
    expect(
      await messagesFor({ taxId: '12345678901', taxIdType: 'RG' }),
    ).toEqual(['taxIdType must be one of the following values: CPF, CNPJ']);
  });

  it('rejects a taxId sent as a number', async () => {
    expect(await messagesFor({ taxId: 12345678901, taxIdType: 'CPF' })).toEqual(
      ['taxId must be a string of digits'],
    );
  });
});
