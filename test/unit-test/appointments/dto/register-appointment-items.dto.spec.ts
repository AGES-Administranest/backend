import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RegisterAppointmentItemsDto } from '../../../../src/modules/appointments/dto/register-appointment-items.dto';

const ITEM_ID = '3f7b1c4a-8e2d-4f1a-9c3b-2d4e5f6a7b8c';

const occurredAtErrors = async (occurredAt: unknown) => {
  const dto = plainToInstance(RegisterAppointmentItemsDto, {
    items: [{ itemId: ITEM_ID, quantity: 1, occurredAt }],
  });
  const [itemsError] = await validate(dto);
  return (
    itemsError?.children?.[0]?.children?.filter(
      e => e.property === 'occurredAt',
    ) ?? []
  );
};

describe('RegisterAppointmentItemsDto — occurredAt', () => {
  it.each([
    ['UTC', '2026-09-24T10:15:00.000Z'],
    ['sem milissegundos', '2026-09-24T10:15:00Z'],
    ['com offset', '2026-09-24T07:15:00-03:00'],
  ])('aceita data e hora %s', async (_label, occurredAt) => {
    expect(await occurredAtErrors(occurredAt)).toHaveLength(0);
  });

  it('aceita a linha sem occurredAt', async () => {
    expect(await occurredAtErrors(undefined)).toHaveLength(0);
  });

  it.each([
    ['sem offset — dependeria do fuso do servidor', '2026-09-24T10:15:00'],
    ['só a data', '2026-09-24'],
    ['uma data inexistente', '2026-02-30T10:00:00Z'],
    ['texto que não é data', 'ontem'],
  ])('rejeita %s', async (_label, occurredAt) => {
    expect(await occurredAtErrors(occurredAt)).not.toHaveLength(0);
  });
});
