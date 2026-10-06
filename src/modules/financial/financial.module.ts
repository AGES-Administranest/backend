import { Module } from '@nestjs/common';

import { FinancialCategoryController } from './financial-category.controller';
import { FinancialCategoryRepository } from './financial-category.repository';
import { FinancialCategoryService } from './financial-category.service';
import { FinancialEntryController } from './financial-entry.controller';
import { FinancialEntryRepository } from './financial-entry.repository';
import { FinancialEntryService } from './financial-entry.service';

@Module({
  controllers: [FinancialCategoryController, FinancialEntryController],
  exports: [FinancialEntryService],
  providers: [
    FinancialCategoryService,
    FinancialCategoryRepository,
    FinancialEntryService,
    FinancialEntryRepository,
  ],
})
export class FinancialModule {}
