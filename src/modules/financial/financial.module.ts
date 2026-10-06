import { Module } from '@nestjs/common';

import { FinancialCategoryController } from './financial-category.controller';
import { FinancialCategoryRepository } from './financial-category.repository';
import { FinancialCategoryService } from './financial-category.service';

@Module({
  controllers: [FinancialCategoryController],
  providers: [FinancialCategoryService, FinancialCategoryRepository],
})
export class FinancialModule {}
