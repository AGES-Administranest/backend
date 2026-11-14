import { Prisma, StockMovementType } from '@prisma/client';

import {
  type ConsumableMovement,
  consumptionByItem,
} from '../../../../src/modules/stock-movements/domain/stock-summary.rules';

const d = (value: string | number) => new Prisma.Decimal(value);
const propofol = { id: 'i-1', name: 'Propofol 1%', unit: 'MILLILITER' };
const syringe = { id: 'i-2', name: 'Seringa 3 mL', unit: 'UNIT' };

const movement = (
  overrides: Partial<ConsumableMovement>,
): ConsumableMovement => ({
  type: StockMovementType.OUTBOUND,
  quantity: d(1),
  unitCost: d(1),
  appointmentId: 'a-1',
  item: propofol,
  ...overrides,
});

describe('consumptionByItem', () => {
  it('adds up what the appointments used, by item, most expensive first', () => {
    const result = consumptionByItem([
      movement({ item: syringe, quantity: d(4), unitCost: d('0.65') }),
      movement({ quantity: d(20), unitCost: d('0.70') }),
      movement({ appointmentId: 'a-2', quantity: d(10), unitCost: d('0.70') }),
    ]);

    expect(
      result.map(item => [
        item.itemName,
        item.quantity.toString(),
        item.cost.toFixed(2),
      ]),
    ).toEqual([
      ['Propofol 1%', '30', '21.00'],
      ['Seringa 3 mL', '4', '2.60'],
    ]);
  });

  it('subtracts the reversal of a corrected supply', () => {
    const result = consumptionByItem([
      movement({ quantity: d(20), unitCost: d('0.70') }),
      // the supply was corrected: reversed, then recorded again with 15
      movement({
        type: StockMovementType.INBOUND,
        quantity: d(20),
        unitCost: d('0.70'),
      }),
      movement({ quantity: d(15), unitCost: d('0.70') }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].quantity.toString()).toBe('15');
    expect(result[0].cost.toFixed(2)).toBe('10.50');
  });

  it('drops an item whose use was fully reversed', () => {
    expect(
      consumptionByItem([
        movement({ quantity: d(5) }),
        movement({ type: StockMovementType.INBOUND, quantity: d(5) }),
      ]),
    ).toEqual([]);
  });

  it('ignores movements not tied to an appointment, such as losses', () => {
    expect(
      consumptionByItem([movement({ appointmentId: null, quantity: d(3) })]),
    ).toEqual([]);
  });
});
