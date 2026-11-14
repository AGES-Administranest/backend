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
      putDocument: jest.fn(() => {
        calls.push('put');
        return Promise.resolve();
      }),
      createPresignedGet: jest
        .fn()
        .mockResolvedValue({ url: 'https://bucket/file', expiresAt: 123 }),
    };
    const repository = {
      createGenerated: jest.fn(() => {
        calls.push('record');
        return Promise.resolve({});
      }),
    };
    const service = new ReportExportService(
      generalReport as never,
      users as never,
      renderer,
      storage as never,
      repository as never,
    );
    return { service, calls, generalReport, renderer, storage, repository };
  };

  it('stores the PDF, records it and answers with a download link', async () => {
    const { service, calls, generalReport, storage, repository } = build();

    const result = await service.generate(userId, dto);

    expect(generalReport.generate).toHaveBeenCalledWith(userId, dto);
    const key = `users/user-1/reports/${result.id}/original`;
    expect(storage.putDocument).toHaveBeenCalledWith(
      key,
      Buffer.from('%PDF-fake'),
      'application/pdf',
    );
    expect(repository.createGenerated).toHaveBeenCalledWith({
      id: result.id,
      userId,
      kind: 'GENERAL_REPORT',
      periodStart: new Date('2026-10-15T00:00:00Z'),
      periodEnd: new Date('2026-11-14T00:00:00Z'),
      filters: { sections: ['TRIPS'] },
      fileKey: key,
    });
    // The file first: a row without a file would be a broken history item.
    expect(calls).toEqual(['put', 'record']);
    expect(storage.createPresignedGet).toHaveBeenCalledWith(
      expect.objectContaining({
        key,
        fileName: 'administranest_relatorio-geral_2026-10-15_2026-11-14.pdf',
      }),
    );
    expect(result).toMatchObject({
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

  it('records nothing when the file cannot be stored', async () => {
    const { service, storage, repository } = build();
    storage.putDocument.mockRejectedValue(new Error('bucket down'));

    await expect(service.generate(userId, dto)).rejects.toThrow('bucket down');
    expect(repository.createGenerated).not.toHaveBeenCalled();
  });
});
