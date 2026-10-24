import { Module } from '@nestjs/common';

import { FixedCostsController } from './fixed-costs.controller';
import { FixedCostsRepository } from './fixed-costs.repository';
import { FixedCostsService } from './fixed-costs.service';
import { EquipmentModule } from '../equipment';
import { FinancialModule } from '../financial';

@Module({
  imports: [FinancialModule, EquipmentModule],
  controllers: [FixedCostsController],
  providers: [FixedCostsService, FixedCostsRepository],
})
export class FixedCostsModule {}
