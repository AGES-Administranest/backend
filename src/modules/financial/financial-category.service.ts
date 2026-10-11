import { Injectable } from '@nestjs/common';

import { QueryFinancialCategoryDto } from './dto/query-financial-category.dto';
import { FinancialCategoryResponse } from './entities/financial-category.entity';
import { FinancialCategoryRepository } from './financial-category.repository';

@Injectable()
export class FinancialCategoryService {
  constructor(private readonly repository: FinancialCategoryRepository) {}

  findAll(
    userId: string,
    query: QueryFinancialCategoryDto,
  ): Promise<FinancialCategoryResponse[]> {
    return this.repository.findActive(userId, query.nature);
  }
}
