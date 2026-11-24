import { FixedCostsController } from '../../../src/modules/fixed-costs/fixed-costs.controller';
import { FixedCostsService } from '../../../src/modules/fixed-costs/fixed-costs.service';
import { HourlyRateHistoryService } from '../../../src/modules/pricing/hourly-rate-history.service';
import { HourlyRateService } from '../../../src/modules/pricing/hourly-rate.service';
import { PricingController } from '../../../src/modules/pricing/pricing.controller';
import { ProcedureEstimateController } from '../../../src/modules/pricing/procedure-estimate.controller';
import { ProcedureEstimateService } from '../../../src/modules/pricing/procedure-estimate.service';
import { PricingSettingsController } from '../../../src/modules/pricing-settings/pricing-settings.controller';
import { PricingSettingsService } from '../../../src/modules/pricing-settings/pricing-settings.service';
import { describeRoutes, OTHER_ID, USER } from '../testing/routes';

const settings = {
  monthlyIncomeGoal: 10000,
  weeklyHours: 40,
  safetyMarginPct: 10,
};
const estimate = {
  durationMinutes: 90,
  supplies: [{ itemId: OTHER_ID, quantity: 1 }],
};

describeRoutes('pricing', {
  controllers: [
    PricingController,
    ProcedureEstimateController,
    PricingSettingsController,
    FixedCostsController,
  ],
  services: [
    HourlyRateService,
    HourlyRateHistoryService,
    ProcedureEstimateService,
    PricingSettingsService,
    FixedCostsService,
  ],
  routes: [
    {
      route: 'GET /pricing/hourly-rate?month=10&year=2026',
      calls: [
        HourlyRateService,
        'calculate',
        USER.id,
        { month: 10, year: 2026 },
      ],
    },
    {
      route: 'GET /pricing/hourly-rate/history?from=2026-01&to=2026-10',
      calls: [
        HourlyRateHistoryService,
        'list',
        USER.id,
        { from: '2026-01', to: '2026-10' },
      ],
    },
    {
      route: 'GET /pricing/hourly-rate/history/2026/10',
      calls: [
        HourlyRateHistoryService,
        'findMonth',
        USER.id,
        { year: 2026, month: 10 },
      ],
    },
    // A simulation: nothing is created, so it is not a 201.
    {
      route: 'POST /pricing/procedure-estimate',
      body: estimate,
      status: 200,
      calls: [ProcedureEstimateService, 'estimate', USER.id, estimate],
    },
    {
      route: 'GET /pricing-settings',
      calls: [PricingSettingsService, 'find', USER.id],
    },
    {
      route: 'PUT /pricing-settings',
      body: settings,
      calls: [PricingSettingsService, 'save', USER.id, settings],
    },
    {
      route: 'GET /pricing-settings/transport',
      calls: [PricingSettingsService, 'findTransportCost', USER.id],
    },
    {
      route: 'PATCH /pricing-settings/transport',
      body: { transportCostMonthly: 0 },
      calls: [
        PricingSettingsService,
        'saveTransportCost',
        USER.id,
        { transportCostMonthly: 0 },
      ],
    },
    {
      route: 'GET /fixed-costs/summary?month=10&year=2026',
      calls: [
        FixedCostsService,
        'getSummary',
        USER.id,
        { month: 10, year: 2026 },
      ],
    },
  ],
});
