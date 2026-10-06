import { EntryNature } from '@prisma/client';

import { QueryFinancialCategoryDto } from './dto/query-financial-category.dto';
import { FinancialCategoryService } from './financial-category.service';

describe('FinancialCategoryService', () => {
  let repository: { findActive: jest.Mock };
  let service: FinancialCategoryService;

  beforeEach(() => {
    repository = { findActive: jest.fn().mockResolvedValue([]) };
    service = new FinancialCategoryService(repository as never);
  });

  it('asks the repository for this user, with no nature filter', async () => {
    await service.findAll('user-1', new QueryFinancialCategoryDto());

    expect(repository.findActive).toHaveBeenCalledWith('user-1', undefined);
  });

  it('forwards the nature filter', async () => {
    const query = new QueryFinancialCategoryDto();
    query.nature = EntryNature.EXPENSE;

    await service.findAll('user-1', query);

    expect(repository.findActive).toHaveBeenCalledWith(
      'user-1',
      EntryNature.EXPENSE,
    );
  });
});
