import { GeneralReportService } from '../../../src/modules/reports/general-report.service';
import { ReportExportService } from '../../../src/modules/reports/report-export.service';
import { ReportHistoryController } from '../../../src/modules/reports/report-history.controller';
import { ReportHistoryService } from '../../../src/modules/reports/report-history.service';
import { ReportsController } from '../../../src/modules/reports/reports.controller';
import { ReportsService } from '../../../src/modules/reports/reports.service';
import { TaxPackageService } from '../../../src/modules/reports/tax-package.service';
import { describeRoutes, ID, USER } from '../testing/routes';

const period = { from: '2026-10-01', to: '2026-10-31' };
const query = 'from=2026-10-01&to=2026-10-31';

describeRoutes('reports', {
  controllers: [ReportsController, ReportHistoryController],
  services: [
    ReportsService,
    TaxPackageService,
    GeneralReportService,
    ReportExportService,
    ReportHistoryService,
  ],
  routes: [
    {
      route: `GET /reports/availability?${query}`,
      calls: [ReportsService, 'getAvailability', USER.id, period],
    },
    {
      route: `GET /reports/tax-package/summary?${query}`,
      calls: [TaxPackageService, 'getSummary', USER.id, period],
    },
    {
      route: 'POST /reports/tax-package',
      body: period,
      calls: [TaxPackageService, 'generate', USER.id, period],
    },
    {
      route: `GET /reports/general?${query}`,
      calls: [GeneralReportService, 'generate', USER.id, period],
    },
    {
      route: 'POST /reports',
      body: { ...period, sections: ['FINANCIAL'] },
      status: 201,
      calls: [
        ReportExportService,
        'generate',
        USER.id,
        { ...period, sections: ['FINANCIAL'] },
      ],
    },
    {
      route: 'GET /reports?kind=TAX_PACKAGE&page=2',
      calls: [
        ReportHistoryService,
        'list',
        USER.id,
        { kind: 'TAX_PACKAGE', page: 2, limit: 20 },
      ],
    },
    {
      route: `GET /reports/${ID}/file`,
      calls: [ReportHistoryService, 'downloadUrl', USER.id, ID],
    },
    {
      route: `DELETE /reports/${ID}`,
      status: 204,
      calls: [ReportHistoryService, 'remove', USER.id, ID],
    },
  ],
});
