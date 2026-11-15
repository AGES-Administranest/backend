import { ReportExportService } from '../../../../src/modules/reports/report-export.service';

describe('ReportExportService.generate', () => {
  const userId = 'user-1';
  const dto = { from: '2026-10-15', to: '2026-11-14' };
  const report = {
    period: { from: '2026-10-15', to: '2026-11-14' },
    sections: [
      {
        type: 'TRIPS',
        empty: true,
        count: 0,
        distanceKm: '0.00',
        cost: '0.00',
      },
    ],
    generatedAt: new Date('2026-11-11T23:20:00Z'),
  };

  const build = (crmv: string | null = 'RS 12345') => {
    const calls: string[] = [];
    const generalReport = { generate: jest.fn().mockResolvedValue(report) };
    const users = {
      findProfile: jest.fn().mockResolvedValue({ name: 'Ana Souza', crmv }),
    };
    const renderer = {
      render: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
    };
    const storage = {
      createPresignedGet: jest.fn(() => {
        calls.push('link');
        return Promise.resolve({ url: 'https://bucket/file', expiresAt: 123 });
      }),
    };
    const archive = {
      store: jest.fn(() => {
        calls.push('store');
        return Promise.resolve('report-1');
      }),
    };
    const service = new ReportExportService(
      generalReport as never,
      users as never,
      renderer,
      storage as never,
      archive as never,
    );
    return { service, calls, generalReport, renderer, storage, archive };
  };

  it('keeps the PDF in the history and answers with a download link', async () => {
    const { service, calls, generalReport, storage, archive } = build();

    const result = await service.generate(userId, dto);

    expect(generalReport.generate).toHaveBeenCalledWith(userId, dto);
    expect(archive.store).toHaveBeenCalledWith(userId, {
      kind: 'GENERAL_REPORT',
      period: report.period,
      filters: { sections: ['TRIPS'] },
      fileName: 'administranest_relatorio-geral_2026-10-15_2026-11-14.pdf',
      contentType: 'application/pdf',
      body: Buffer.from('%PDF-fake'),
    });
    // The link points at the file store() kept, under the id it returned.
    expect(calls).toEqual(['store', 'link']);
    expect(storage.createPresignedGet).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'users/user-1/reports/report-1/original',
        fileName: 'administranest_relatorio-geral_2026-10-15_2026-11-14.pdf',
      }),
    );
    expect(result).toMatchObject({
      id: 'report-1',
      kind: 'GENERAL_REPORT',
      fileName: 'administranest_relatorio-geral_2026-10-15_2026-11-14.pdf',
      period: report.period,
      sections: ['TRIPS'],
      generatedAt: report.generatedAt,
      downloadUrl: 'https://bucket/file',
      downloadUrlExpiresAt: 123,
      professionalIdComplete: true,
    });
  });

  it.each([null, '   '])(
    'says the professional id is incomplete without a CRMV (%p)',
    async crmv => {
      const { service } = build(crmv);
      const result = await service.generate(userId, dto);

      expect(result.professionalIdComplete).toBe(false);
    },
  );

  it('fails without a download link when the file cannot be stored', async () => {
    const { service, storage, archive } = build();
    archive.store.mockRejectedValue(new Error('bucket down'));

    await expect(service.generate(userId, dto)).rejects.toThrow('bucket down');
    expect(storage.createPresignedGet).not.toHaveBeenCalled();
  });
});
