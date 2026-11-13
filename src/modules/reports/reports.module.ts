import { Module } from '@nestjs/common';

import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { TaxPackageService } from './tax-package.service';
import { AppointmentsModule } from '../appointments';
import { EquipmentModule } from '../equipment';
import { FinancialModule } from '../financial';
import { ServiceInvoicesModule } from '../service-invoices';
import { StockEntryModule } from '../stock-entry';
import { StockMovementsModule } from '../stock-movements';
import { TripsModule } from '../trips';

@Module({
  imports: [
    AppointmentsModule,
    FinancialModule,
    ServiceInvoicesModule,
    StockEntryModule,
    StockMovementsModule,
    TripsModule,
    EquipmentModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService, TaxPackageService],
  exports: [ReportsService],
})
export class ReportsModule {}
