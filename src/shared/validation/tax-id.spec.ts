import { TaxIdType } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { IsEnum, IsOptional, validate } from 'class-validator';

import {
  hasTaxIdFormat,
  IsValidTaxIdPair,
  TAX_ID_DIGITS,
  taxIdPairProblem,
} from './tax-id';

const TOGETHER =
  'taxId and taxIdType must be sent together: both set, or both null to remove the tax id';

describe('TAX_ID_DIGITS', () => {
  it('has 11 digits for a CPF and 14 for a CNPJ', () => {
    expect(TAX_ID_DIGITS).toEqual({ CPF: 11, CNPJ: 14 });
  });
});

describe('hasTaxIdFormat', () => {
  it.each([
    ['12345678901', 'CPF', true],
    ['1234567890', 'CPF', false],
    ['123456789012', 'CPF', false],
    ['123.456.789-01', 'CPF', false],
    ['12345678000190', 'CNPJ', true],
    ['1234567800019', 'CNPJ', false],
    ['123456780001901', 'CNPJ', false],
    ['12.345.678/0001-90', 'CNPJ', false],
    ['12345678901', 'CNPJ', false],
    ['12345678000190', 'CPF', false],
    ['1234567890a', 'CPF', false],
    ['', 'CPF', false],
  ] as const)('%p as a %s → %p', (taxId, taxIdType, expected) => {
    expect(hasTaxIdFormat(taxId, taxIdType)).toBe(expected);
  });
});

describe('taxIdPairProblem', () => {
  it.each([
    ['neither field sent', {}],
    ['both null, to remove the tax id', { taxId: null, taxIdType: null }],
    ['a valid CPF', { taxId: '12345678901', taxIdType: 'CPF' }],
    ['a valid CNPJ', { taxId: '12345678000190', taxIdType: 'CNPJ' }],
  ])('accepts %s', (_case, pair) => {
    expect(taxIdPairProblem(pair)).toBeNull();
  });

  it.each([
    ['taxId without its type', { taxId: '12345678901' }],
    ['taxIdType without a number', { taxIdType: 'CPF' }],
    ['taxId null on its own', { taxId: null }],
    ['taxIdType null on its own', { taxIdType: null }],
    ['a number with a null type', { taxId: '12345678901', taxIdType: null }],
    ['a type with a null number', { taxId: null, taxIdType: 'CNPJ' }],
  ])('requires both fields together: %s', (_case, pair) => {
    expect(taxIdPairProblem(pair)).toBe(TOGETHER);
  });

  it.each([
    ['CPF', '1234567890', 11],
    ['CPF', '123.456.789-01', 11],
    ['CPF', '12345678000190', 11],
    ['CNPJ', '1234567800019', 14],
    ['CNPJ', '12.345.678/0001-90', 14],
    ['CNPJ', '12345678901', 14],
  ])('explains the expected format of a %s: %p', (taxIdType, taxId, digits) => {
    expect(taxIdPairProblem({ taxId, taxIdType })).toBe(
      `taxId must have exactly ${digits} digits, with no punctuation, when taxIdType is ${taxIdType}`,
    );
  });

  it('rejects a taxId that is not a string', () => {
    expect(taxIdPairProblem({ taxId: 12345678901, taxIdType: 'CPF' })).toBe(
      'taxId must be a string of digits',
    );
  });

  it('leaves an unknown taxIdType to @IsEnum instead of reporting it twice', () => {
    expect(
      taxIdPairProblem({ taxId: '12345678901', taxIdType: 'RG' }),
    ).toBeNull();
  });
});

describe('@IsValidTaxIdPair', () => {
  class Payload {
    @IsValidTaxIdPair()
    taxId?: string | null;

    @IsOptional()
    @IsEnum(TaxIdType)
    taxIdType?: TaxIdType | null;
  }

  const messagesFor = async (body: Record<string, unknown>) => {
    const errors = await validate(plainToInstance(Payload, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    return errors.flatMap(error => Object.values(error.constraints ?? {}));
  };

  it('passes when neither field is sent', async () => {
    expect(await messagesFor({})).toEqual([]);
  });

  it('passes a valid pair', async () => {
    expect(
      await messagesFor({ taxId: '12345678000190', taxIdType: 'CNPJ' }),
    ).toEqual([]);
  });

  it('runs even when only taxIdType was sent', async () => {
    expect(await messagesFor({ taxIdType: 'CPF' })).toEqual([TOGETHER]);
  });

  it('reports a wrong format once, with the expected number of digits', async () => {
    expect(
      await messagesFor({ taxId: '123.456.789-01', taxIdType: 'CPF' }),
    ).toEqual([
      'taxId must have exactly 11 digits, with no punctuation, when taxIdType is CPF',
    ]);
  });

  it('reports an unknown taxIdType only through @IsEnum', async () => {
    expect(
      await messagesFor({ taxId: '12345678901', taxIdType: 'RG' }),
    ).toEqual(['taxIdType must be one of the following values: CPF, CNPJ']);
  });
});
