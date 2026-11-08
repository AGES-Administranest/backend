import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateSupplierDto } from '../../../src/modules/supplier/dto/create-supplier.dto';
import { UpdateSupplierDto } from '../../../src/modules/supplier/dto/update-supplier.dto';

const messagesFor = async (
  dto: new () => object,
  body: Record<string, unknown>,
) => {
  const errors = await validate(plainToInstance(dto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.flatMap(error => Object.values(error.constraints ?? {}));
};

describe.each([
  ['CreateSupplierDto', CreateSupplierDto],
  ['UpdateSupplierDto', UpdateSupplierDto],
])('%s CNPJ validation', (_name, dto) => {
  it('accepts a valid CNPJ and normalizes its mask', async () => {
    const body = {
      name: 'Test supplier',
      taxId: '22.333.444/0001-81',
      taxIdType: 'CNPJ',
    };

    expect(await messagesFor(dto, body)).toEqual([]);
    expect(
      plainToInstance<object, Record<string, unknown>>(dto, body),
    ).toMatchObject({
      taxId: '22333444000181',
    });
  });

  it('requires the tax id and its type together', async () => {
    expect(await messagesFor(dto, { taxId: '22333444000181' })).toContain(
      'taxId and taxIdType must be sent together: both set, or both null to remove the tax id',
    );
  });

  it('rejects a type without a tax id', async () => {
    expect(await messagesFor(dto, { taxIdType: 'CNPJ' })).toContain(
      'taxId and taxIdType must be sent together: both set, or both null to remove the tax id',
    );
  });

  it('rejects a CNPJ with the wrong number of digits', async () => {
    expect(
      await messagesFor(dto, { taxId: '1234567890', taxIdType: 'CNPJ' }),
    ).toContain(
      'taxId must have exactly 14 digits, with no punctuation, when taxIdType is CNPJ',
    );
  });

  it('rejects CPF as a supplier tax id', async () => {
    expect(
      await messagesFor(dto, { taxId: '12345678901', taxIdType: 'CPF' }),
    ).toContain('taxIdType must be one of the following values: CNPJ');
  });
});
