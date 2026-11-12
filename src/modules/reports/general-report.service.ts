import { Injectable } from '@nestjs/common';

import { EquipmentService } from '../equipment';
import { ReportSection, selectedSections } from './domain/report-sections';
import { QueryGeneralReportDto } from './dto/query-general-report.dto';
import {
  GeneralReportEntity,
  GeneralReportSection,
} from './entities/general-report.entity';
import { CostsSectionBuilder } from './general-report/costs-section.builder';
import { FinancialSectionBuilder } from './general-report/financial-section.builder';
import { OperationsSectionBuilder } from './general-report/operations-section.builder';
import { ReportContext } from './general-report/report-context';
import { StockSectionBuilder } from './general-report/stock-section.builder';

/**
 * The general report (US29): one document with the period's financial and
 * operational picture, made of the sections the user selected. It feeds the
 * preview (US27) and the PDF (US28).
 *
 * It owns no table and no calculation: each section asks the module that owns
 * the records, by the same rules that module's own screens use.
 */
@Injectable()
export class GeneralReportService {
  constructor(
    private readonly equipment: EquipmentService,
    private readonly financial: FinancialSectionBuilder,
    private readonly operations: OperationsSectionBuilder,
    private readonly stock: StockSectionBuilder,
    private readonly costs: CostsSectionBuilder,
  ) {}

  /**
   * @throws DomainError `REPORT_PERIOD_INVALID` when `from` is after `to`.
   * @throws DomainError `REPORT_PERIOD_TOO_LONG` past `MAX_REPORT_DAYS` (366).
   * @throws DomainError `REPORT_SECTIONS_EMPTY` when no section is selected.
   */
  async generate(
    userId: string,
    query: QueryGeneralReportDto,
  ): Promise<GeneralReportEntity> {
    const context = new ReportContext(
      userId,
      query.from,
      query.to,
      this.equipment,
    );
    const sections = selectedSections(query.sections);

    return {
      period: { from: query.from, to: query.to },
      sections: await Promise.all(
        sections.map(section => this.build(section, context)),
      ),
      generatedAt: new Date(),
    };
  }

  private build(
    section: ReportSection,
    context: ReportContext,
  ): Promise<GeneralReportSection> {
    switch (section) {
      case 'FINANCIAL':
        return this.financial.build(context);
      case 'APPOINTMENTS':
        return this.operations.appointmentsSection(context);
      case 'CLIENTS':
        return this.operations.clientsSection(context);
      case 'STOCK':
        return this.stock.stockSection(context);
      case 'SUPPLIERS':
        return this.stock.suppliersSection(context);
      case 'TRIPS':
        return this.costs.tripsSection(context);
      case 'DEPRECIATION':
        return this.costs.depreciationSection(context);
      case 'HOURLY_RATE':
        return this.costs.hourlyRateSection(context);
    }
  }
}
