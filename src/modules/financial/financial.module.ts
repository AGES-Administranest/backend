import { Module } from '@nestjs/common';

import { FinancialCategoryController } from './financial-category.controller';
import { FinancialCategoryRepository } from './financial-category.repository';
import { FinancialCategoryService } from './financial-category.service';
import { FinancialEntryController } from './financial-entry.controller';
import { FinancialEntryRepository } from './financial-entry.repository';
import { FinancialEntryService } from './financial-entry.service';
import { MonthlyDepreciation } from './monthly-depreciation';
import { MonthlyDepreciationRepository } from './monthly-depreciation.repository';

@Module({
  controllers: [FinancialCategoryController, FinancialEntryController],
  exports: [FinancialEntryService, MonthlyDepreciation],
  providers: [
    FinancialCategoryService,
    FinancialCategoryRepository,
    FinancialEntryService,
    FinancialEntryRepository,
    MonthlyDepreciation,
    MonthlyDepreciationRepository,
  ],
})
export class FinancialModule {}
