import { Logger } from '@nestjs/common';
import { ReportKind } from '@prisma/client';

import { DocumentStorage } from '../../../src/infra/storage';
import {
  GeneratedFile,
  ReportArchiveService,
} from '../../../src/modules/reports/report-archive.service';
import { ReportHistoryRepository } from '../../../src/modules/reports/report-history.repository';

const USER_ID = '0b9f6c1e-7d2a-4f3b-8c5d-1a2b3c4d5e6f';

const file = (overrides: Partial<GeneratedFile> = {}): GeneratedFile => ({
  kind: ReportKind.GENERAL_REPORT,
  period: { from: '2026-10-15', to: '2026-11-14' },
  filters: { sections: ['FINANCIAL', 'TRIPS'] },
  fileName: 'administranest_relatorio-geral_2026-10-15_2026-11-14.pdf',
  contentType: 'application/pdf',
  body: new Uint8Array([37, 80, 68, 70, 45]),
  ...overrides,
});

describe('ReportArchiveService.store', () => {
  let repository: {
    createPending: jest.Mock;
    markDone: jest.Mock;
    markFailed: jest.Mock;
  };
  let storage: { putDocument: jest.Mock };
  let service: ReportArchiveService;
  let logError: jest.SpyInstance;

  beforeEach(() => {
    repository = {
      createPending: jest.fn().mockResolvedValue(undefined),
      markDone: jest.fn().mockResolvedValue(true),
      markFailed: jest.fn().mockResolvedValue(true),
    };
    storage = { putDocument: jest.fn().mockResolvedValue(undefined) };
    service = new ReportArchiveService(
      storage as unknown as DocumentStorage,
      repository as unknown as ReportHistoryRepository,
    );
    logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('records the row as PENDING with the key, the name and the size', async () => {
    const id = await service.store(USER_ID, file());

    expect(repository.createPending).toHaveBeenCalledWith({
      id,
      userId: USER_ID,
      kind: ReportKind.GENERAL_REPORT,
      periodStart: new Date('2026-10-15T00:00:00.000Z'),
      periodEnd: new Date('2026-11-14T00:00:00.000Z'),
      filters: { sections: ['FINANCIAL', 'TRIPS'] },
      fileKey: `users/${USER_ID}/reports/${id}/original`,
      fileName: 'administranest_relatorio-geral_2026-10-15_2026-11-14.pdf',
      fileBytesSize: 5,
    });
  });

  it('records the row, then stores the file under its key, then marks it DONE', async () => {
    const body = new Uint8Array([1, 2, 3]);

    const id = await service.store(
      USER_ID,
      file({ body, contentType: 'application/zip' }),
    );

    expect(storage.putDocument).toHaveBeenCalledWith(
      `users/${USER_ID}/reports/${id}/original`,
      body,
      'application/zip',
    );
    expect(repository.markDone).toHaveBeenCalledWith(id, USER_ID);
    expect(repository.markFailed).not.toHaveBeenCalled();

    const [created] = repository.createPending.mock.invocationCallOrder;
    const [stored] = storage.putDocument.mock.invocationCallOrder;
    const [done] = repository.markDone.mock.invocationCallOrder;
    expect(created).toBeLessThan(stored);
    expect(stored).toBeLessThan(done);
  });

  it('gives each report its own id', async () => {
    const first = await service.store(USER_ID, file());
    const second = await service.store(USER_ID, file());

    expect(first).not.toBe(second);
  });

  it('marks the row FAILED and rethrows when the upload fails', async () => {
    const uploadError = new Error('bucket unavailable');
    storage.putDocument.mockRejectedValue(uploadError);

    await expect(service.store(USER_ID, file())).rejects.toBe(uploadError);

    const [[{ id }]] = repository.createPending.mock.calls as [
      [{ id: string }],
    ];
    expect(repository.markFailed).toHaveBeenCalledWith(id, USER_ID);
    expect(repository.markDone).not.toHaveBeenCalled();
  });

  it('still rethrows the upload error when FAILED cannot be recorded', async () => {
    const uploadError = new Error('bucket unavailable');
    storage.putDocument.mockRejectedValue(uploadError);
    repository.markFailed.mockRejectedValue(new Error('database down'));

    await expect(service.store(USER_ID, file())).rejects.toBe(uploadError);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('stores nothing when the row cannot be recorded', async () => {
    repository.createPending.mockRejectedValue(new Error('database down'));

    await expect(service.store(USER_ID, file())).rejects.toThrow(
      'database down',
    );
    expect(storage.putDocument).not.toHaveBeenCalled();
  });

  it('fails when the row is no longer PENDING after the upload', async () => {
    repository.markDone.mockResolvedValue(false);

    await expect(service.store(USER_ID, file())).rejects.toThrow(
      /no longer pending/,
    );
  });
});
