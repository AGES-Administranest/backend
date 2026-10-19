import { Prisma } from '@prisma/client';

import { FixedCostsRepository } from '../../../src/modules/fixed-costs/fixed-costs.repository';

describe('FixedCostsRepository', () => {
  it('reads the transport cost of the given user only', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValue({ transportCostMonthly: new Prisma.Decimal('300') });
    const repository = new FixedCostsRepository({
      pricingSettings: { findUnique },
    } as never);

    const result = await repository.findTransportMonthly('user-1');

    expect(result?.toFixed(2)).toBe('300.00');
    expect(findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: { transportCostMonthly: true },
    });
  });

  it.each([
    ['there is no row', null],
    ['the column is null', { transportCostMonthly: null }],
  ])('returns null when %s', async (_name, row) => {
    const repository = new FixedCostsRepository({
      pricingSettings: { findUnique: jest.fn().mockResolvedValue(row) },
    } as never);

    await expect(repository.findTransportMonthly('user-1')).resolves.toBeNull();
  });
});
