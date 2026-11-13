import { Module } from '@nestjs/common';

import { CostsSectionBuilder } from './general-report/costs-section.builder';
import { FinancialSectionBuilder } from './general-report/financial-section.builder';
import { OperationsSectionBuilder } from './general-report/operations-section.builder';
import { StockSectionBuilder } from './general-report/stock-section.builder';
import { ReportArchiveService } from './report-archive.service';
import { ReportHistoryController } from './report-history.controller';
import { ReportHistoryRepository } from './report-history.repository';
import { ReportHistoryService } from './report-history.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AppointmentsModule } from '../appointments';
import { ClientModule } from '../client';
import { EquipmentModule } from '../equipment';
import { FinancialModule } from '../financial';
import { PricingModule } from '../pricing';
import { ServiceInvoicesModule } from '../service-invoices';
import { StockEntryModule } from '../stock-entry';
import { StockMovementsModule } from '../stock-movements';
import { SupplierModule } from '../supplier';
import { TripsModule } from '../trips';
import { GeneralReportService } from './general-report.service';

@Module({
  imports: [
    AppointmentsModule,
    FinancialModule,
    ServiceInvoicesModule,
    StockEntryModule,
    StockMovementsModule,
    TripsModule,
    EquipmentModule,
    ClientModule,
    SupplierModule,
    PricingModule,
  ],
  controllers: [ReportsController, ReportHistoryController],
  providers: [
    ReportsService,
    GeneralReportService,
    FinancialSectionBuilder,
    OperationsSectionBuilder,
    StockSectionBuilder,
    CostsSectionBuilder,
    ReportArchiveService,
    ReportHistoryService,
    ReportHistoryRepository,
  ],
  exports: [ReportsService, ReportArchiveService],
})
export class ReportsModule {}
