import { EntryNature, EntryScope } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateFinancialCategoryDto } from '../../../src/modules/financial/dto/create-financial-category.dto';

const validPayload = {
  id: '3b8f5d2e-1c4a-4e7b-9a60-2f1d8c7e5b43',
  name: 'Comida',
  nature: EntryNature.EXPENSE,
  defaultScope: EntryScope.PERSONAL,
};

const toDto = (overrides: Record<string, unknown>) =>
  plainToInstance(CreateFinancialCategoryDto, {
    ...validPayload,
    ...overrides,
  });

// Same options as the global ValidationPipe in src/main.ts.
const invalidFields = async (overrides: Record<string, unknown>) => {
  const errors = await validate(toDto(overrides), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map(error => error.property);
};

describe('CreateFinancialCategoryDto', () => {
  it('accepts a complete category', async () => {
    expect(await invalidFields({})).toEqual([]);
  });

  it('tidies the name before it is checked', () => {
    expect(toDto({ name: '  Custos   fixos ' }).name).toBe('Custos fixos');
  });

  it('accepts a name of exactly 40 characters', async () => {
    expect(await invalidFields({ name: 'a'.repeat(40) })).toEqual([]);
  });

  it('counts the length after tidying, so surrounding spaces do not count', async () => {
    expect(await invalidFields({ name: `  ${'a'.repeat(40)}  ` })).toEqual([]);
  });

  it.each([
    ['an empty name', { name: '' }, 'name'],
    ['a name with only spaces', { name: '   ' }, 'name'],
    ['a name over 40 characters', { name: 'a'.repeat(41) }, 'name'],
    ['a name that is not text', { name: 42 }, 'name'],
    ['an id that is not a UUID', { id: 'category-1' }, 'id'],
    ['an unknown nature', { nature: 'TRANSFER' }, 'nature'],
    ['an unknown scope', { defaultScope: 'SHARED' }, 'defaultScope'],
    ['an owner in the body', { userId: validPayload.id }, 'userId'],
  ])('rejects %s', async (_case, overrides, field) => {
    expect(await invalidFields(overrides)).toEqual([field]);
  });
});
