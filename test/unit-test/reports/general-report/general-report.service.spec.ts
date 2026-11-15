import { GeneralReportService } from '../../../../src/modules/reports/general-report.service';

describe('GeneralReportService.generate', () => {
  const userId = 'user-1';
  const section = (type: string) => jest.fn().mockResolvedValue({ type });

  const build = () => {
    const equipment = { monthlyDepreciation: jest.fn().mockResolvedValue(0) };
    const financial = { build: section('FINANCIAL') };
    const operations = {
      appointmentsSection: section('APPOINTMENTS'),
      clientsSection: section('CLIENTS'),
    };
    const stock = {
      stockSection: section('STOCK'),
      suppliersSection: section('SUPPLIERS'),
    };
    const costs = {
      tripsSection: section('TRIPS'),
      depreciationSection: section('DEPRECIATION'),
      hourlyRateSection: section('HOURLY_RATE'),
    };
    const service = new GeneralReportService(
      equipment as never,
      financial as never,
      operations as never,
      stock as never,
      costs as never,
    );
    return { service, financial, operations, stock, costs };
  };

  it('builds every section when none is selected, in the order of the document', async () => {
    const { service } = build();
    const report = await service.generate(userId, {
      from: '2026-10-15',
      to: '2026-11-14',
    });

    expect(report.period).toEqual({ from: '2026-10-15', to: '2026-11-14' });
    expect(report.sections.map(s => s.type)).toEqual([
      'FINANCIAL',
      'APPOINTMENTS',
      'CLIENTS',
      'STOCK',
      'SUPPLIERS',
      'TRIPS',
      'DEPRECIATION',
      'HOURLY_RATE',
    ]);
    expect(report.generatedAt).toBeInstanceOf(Date);
  });

  it('builds only the selected sections', async () => {
    const { service, financial, operations, stock, costs } = build();
    const report = await service.generate(userId, {
      from: '2026-10-01',
      to: '2026-10-31',
      sections: ['TRIPS', 'APPOINTMENTS'],
    });

    expect(report.sections.map(s => s.type)).toEqual(['APPOINTMENTS', 'TRIPS']);
    expect(financial.build).not.toHaveBeenCalled();
    expect(operations.clientsSection).not.toHaveBeenCalled();
    expect(stock.stockSection).not.toHaveBeenCalled();
    expect(costs.hourlyRateSection).not.toHaveBeenCalled();
  });

  it('gives every section the same context', async () => {
    const { service, operations, costs } = build();
    await service.generate(userId, {
      from: '2026-10-01',
      to: '2026-10-31',
      sections: ['APPOINTMENTS', 'TRIPS'],
    });

    const [context] = operations.appointmentsSection.mock.calls[0] as [unknown];
    expect(costs.tripsSection).toHaveBeenCalledWith(context);
    expect(context).toMatchObject({
      userId,
      from: '2026-10-01',
      to: '2026-10-31',
    });
  });

  it('refuses a period that ends before it starts', async () => {
    const { service } = build();
    await expect(
      service.generate(userId, { from: '2026-11-01', to: '2026-10-01' }),
    ).rejects.toMatchObject({ code: 'REPORT_PERIOD_INVALID' });
  });

  it('refuses an empty selection', async () => {
    const { service } = build();
    await expect(
      service.generate(userId, {
        from: '2026-10-01',
        to: '2026-10-31',
        sections: [],
      }),
    ).rejects.toMatchObject({ code: 'REPORT_SECTIONS_EMPTY' });
  });
});
