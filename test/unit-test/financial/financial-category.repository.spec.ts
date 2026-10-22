import { FinancialCategoryRepository } from '../../../src/modules/financial/financial-category.repository';

describe('FinancialCategoryRepository.findNames', () => {
  it('reads only default categories and the caller categories', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new FinancialCategoryRepository({
      financialCategory: { findMany },
    } as never);

    await repository.findNames('user-1', ['cat-1', 'cat-2']);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['cat-1', 'cat-2'] },
        OR: [{ userId: null }, { userId: 'user-1' }],
      },
      select: { id: true, name: true },
    });
  });
});
