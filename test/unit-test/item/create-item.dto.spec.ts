import { ItemCategory, MeasurementUnit } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateItemDto } from '../../../src/modules/item/dto/create-item.dto';

const validPayload = {
  category: ItemCategory.MEDICATION,
  unit: MeasurementUnit.AMPOULE,
  name: 'Dipirona injetável',
};

const errorsFor = async (overrides: Record<string, unknown>) => {
  const dto = plainToInstance(CreateItemDto, { ...validPayload, ...overrides });
  return validate(dto);
};

describe('CreateItemDto', () => {
  it('não tem erros no caminho feliz', async () => {
    expect(await errorsFor({})).toHaveLength(0);
  });

  it('rejeita userId no payload — o dono vem do token (ADR-11)', async () => {
    const dto = plainToInstance(CreateItemDto, {
      ...validPayload,
      userId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.some(e => e.property === 'userId')).toBe(true);
  });

  it('rejeita supplierId que não é UUID', async () => {
    const errors = await errorsFor({ supplierId: 'nao-e-um-uuid' });
    expect(errors.some(e => e.property === 'supplierId')).toBe(true);
  });

  it('rejeita name com menos de 2 caracteres', async () => {
    const errors = await errorsFor({ name: 'A' });
    expect(errors.some(e => e.property === 'name')).toBe(true);
  });

  it('rejeita name com mais de 120 caracteres', async () => {
    const errors = await errorsFor({ name: 'A'.repeat(121) });
    expect(errors.some(e => e.property === 'name')).toBe(true);
  });

  it('rejeita category fora do enum', async () => {
    const errors = await errorsFor({ category: 'INVALID' });
    expect(errors.some(e => e.property === 'category')).toBe(true);
  });

  it('rejeita unit fora do enum', async () => {
    const errors = await errorsFor({ unit: 'INVALID' });
    expect(errors.some(e => e.property === 'unit')).toBe(true);
  });

  it('rejeita defaultUnitCost negativo', async () => {
    const errors = await errorsFor({ defaultUnitCost: -1 });
    expect(errors.some(e => e.property === 'defaultUnitCost')).toBe(true);
  });

  it('rejeita minimumStock negativo', async () => {
    const errors = await errorsFor({ minimumStock: -1 });
    expect(errors.some(e => e.property === 'minimumStock')).toBe(true);
  });

  it('rejeita currentQuantity negativo', async () => {
    const errors = await errorsFor({ currentQuantity: -1 });
    expect(errors.some(e => e.property === 'currentQuantity')).toBe(true);
  });
});
