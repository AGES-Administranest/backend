import { ItemCategory, MeasurementUnit } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateItemDto } from '../../../src/modules/item/dto/update-item.dto';

const errorsFor = async (payload: Record<string, unknown>) => {
  const dto = plainToInstance(UpdateItemDto, payload);
  return validate(dto);
};

describe('UpdateItemDto', () => {
  it('não tem erros com payload vazio (edição parcial)', async () => {
    expect(await errorsFor({})).toHaveLength(0);
  });

  it('não tem erros ao enviar só um campo válido', async () => {
    expect(await errorsFor({ currentQuantity: 5 })).toHaveLength(0);
  });

  it('rejeita name com menos de 2 caracteres quando enviado', async () => {
    const errors = await errorsFor({ name: 'A' });
    expect(errors.some(e => e.property === 'name')).toBe(true);
  });

  it('rejeita name com mais de 120 caracteres quando enviado', async () => {
    const errors = await errorsFor({ name: 'A'.repeat(121) });
    expect(errors.some(e => e.property === 'name')).toBe(true);
  });

  it('rejeita category fora do enum quando enviada', async () => {
    const errors = await errorsFor({ category: 'INVALID' });
    expect(errors.some(e => e.property === 'category')).toBe(true);
  });

  it('rejeita unit fora do enum quando enviada', async () => {
    const errors = await errorsFor({ unit: 'INVALID' });
    expect(errors.some(e => e.property === 'unit')).toBe(true);
  });

  it('rejeita currentQuantity negativo quando enviado', async () => {
    const errors = await errorsFor({ currentQuantity: -1 });
    expect(errors.some(e => e.property === 'currentQuantity')).toBe(true);
  });

  it('rejeita minimumStock negativo quando enviado', async () => {
    const errors = await errorsFor({ minimumStock: -1 });
    expect(errors.some(e => e.property === 'minimumStock')).toBe(true);
  });

  it('rejeita defaultUnitCost negativo quando enviado', async () => {
    const errors = await errorsFor({ defaultUnitCost: -1 });
    expect(errors.some(e => e.property === 'defaultUnitCost')).toBe(true);
  });

  it('aceita atualizar name e unit juntos', async () => {
    const errors = await errorsFor({
      name: 'Novo nome',
      unit: MeasurementUnit.VIAL,
    });
    expect(errors).toHaveLength(0);
  });

  it('aceita category válida quando enviada', async () => {
    const errors = await errorsFor({ category: ItemCategory.ANESTHETIC });
    expect(errors).toHaveLength(0);
  });
});
