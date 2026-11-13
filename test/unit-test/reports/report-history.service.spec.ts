import { Logger } from '@nestjs/common';
import { Report, ReportKind, ReportStatus } from '@prisma/client';

import { DocumentStorage } from '../../../src/infra/storage';
import { ReportHistoryRepository } from '../../../src/modules/reports/report-history.repository';
import { ReportHistoryService } from '../../../src/modules/reports/report-history.service';
import { DomainError } from '../../../src/shared/errors/domain-error';

const USER_ID = '0b9f6c1e-7d2a-4f3b-8c5d-1a2b3c4d5e6f';
const REPORT_ID = '5f3b7d0c-2a1e-4c7b-9a11-1f2e3d4c5b6a';
const KEY = `users/${USER_ID}/reports/${REPORT_ID}/original`;

const row = (overrides: Partial<Report> = {}): Report => ({
  id: REPORT_ID,
  userId: USER_ID,
  kind: ReportKind.GENERAL_REPORT,
  periodStart: new Date('2026-10-15T00:00:00.000Z'),
  periodEnd: new Date('2026-11-14T00:00:00.000Z'),
  filters: { sections: ['FINANCIAL'] },
  fileUrl: KEY,
  fileName: 'administranest_relatorio-geral_2026-10-15_2026-11-14.pdf',
  fileBytesSize: 184320,
  status: ReportStatus.DONE,
  createdAt: new Date('2026-11-12T18:30:00.000Z'),
  deletedAt: null,
  ...overrides,
});

const expectNotFound = async (promise: Promise<unknown>) => {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(DomainError);
  expect(error).toMatchObject({ kind: 'NOT_FOUND', code: 'REPORT_NOT_FOUND' });
};

describe('ReportHistoryService', () => {
  let repository: {
    findPage: jest.Mock;
    findListed: jest.Mock;
    softDelete: jest.Mock;
  };
  let storage: { createPresignedGet: jest.Mock; deleteDocument: jest.Mock };
  let service: ReportHistoryService;
  let logError: jest.SpyInstance;

  beforeEach(() => {
    repository = {
      findPage: jest.fn().mockResolvedValue([row()]),
      findListed: jest.fn().mockResolvedValue(row()),
      softDelete: jest.fn().mockResolvedValue(true),
    };
    storage = {
      createPresignedGet: jest
        .fn()
        .mockResolvedValue({ url: 'https://bucket/signed', expiresAt: 42 }),
      deleteDocument: jest.fn().mockResolvedValue(undefined),
    };
    service = new ReportHistoryService(
      repository as unknown as ReportHistoryRepository,
      storage as unknown as DocumentStorage,
    );
    logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('list', () => {
    it('asks the repository for the user page and kind', async () => {
      const query = { kind: ReportKind.TAX_PACKAGE, page: 3, limit: 10 };

      await service.list(USER_ID, query);

      expect(repository.findPage).toHaveBeenCalledWith(USER_ID, query);
    });

    it('answers each report with its period as dates and when it was generated', async () => {
      await expect(
        service.list(USER_ID, { page: 1, limit: 20 }),
      ).resolves.toEqual([
        {
          id: REPORT_ID,
          kind: ReportKind.GENERAL_REPORT,
          fileName: 'administranest_relatorio-geral_2026-10-15_2026-11-14.pdf',
          fileBytesSize: 184320,
          period: { from: '2026-10-15', to: '2026-11-14' },
          generatedAt: new Date('2026-11-12T18:30:00.000Z'),
        },
      ]);
    });

    it('answers a null period for a row without one', async () => {
      repository.findPage.mockResolvedValue([
        row({ periodStart: null, periodEnd: null }),
      ]);

      const [item] = await service.list(USER_ID, { page: 1, limit: 20 });

      expect(item.period).toBeNull();
    });

    // The report_done_has_file CHECK rules these rows out; reaching one means
    // the database lost it, which must not reach the app as a null.
    it.each([
      ['file_name', { fileName: null }],
      ['file_bytes_size', { fileBytesSize: null }],
    ])('fails on a DONE row without %s', async (column, missing) => {
      repository.findPage.mockResolvedValue([row(missing)]);

      await expect(
        service.list(USER_ID, { page: 1, limit: 20 }),
      ).rejects.toThrow(`Report ${REPORT_ID} is DONE without ${column}`);
    });

    it('does not expose the filters, the key or the status', async () => {
      const [item] = await service.list(USER_ID, { page: 1, limit: 20 });

      expect(Object.keys(item).sort()).toEqual([
        'fileBytesSize',
        'fileName',
        'generatedAt',
        'id',
        'kind',
        'period',
      ]);
    });
  });

  describe('downloadUrl', () => {
    it('signs the key for five minutes, under the file name', async () => {
      await expect(service.downloadUrl(USER_ID, REPORT_ID)).resolves.toEqual({
        url: 'https://bucket/signed',
        expiresAt: 42,
      });

      expect(repository.findListed).toHaveBeenCalledWith(REPORT_ID, USER_ID);
      expect(storage.createPresignedGet).toHaveBeenCalledWith({
        key: KEY,
        expiresInMs: 5 * 60 * 1000,
        fileName: 'administranest_relatorio-geral_2026-10-15_2026-11-14.pdf',
      });
    });

    it('signs nothing for a DONE row without a file name', async () => {
      repository.findListed.mockResolvedValue(row({ fileName: null }));

      await expect(service.downloadUrl(USER_ID, REPORT_ID)).rejects.toThrow(
        `Report ${REPORT_ID} is DONE without file_name`,
      );
      expect(storage.createPresignedGet).not.toHaveBeenCalled();
    });

    it('answers REPORT_NOT_FOUND and signs nothing for a report the history does not list', async () => {
      repository.findListed.mockResolvedValue(null);

      await expectNotFound(service.downloadUrl(USER_ID, REPORT_ID));
      expect(storage.createPresignedGet).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('removes the row from the history, then the file from the bucket', async () => {
      await service.remove(USER_ID, REPORT_ID);

      expect(repository.softDelete).toHaveBeenCalledWith(REPORT_ID, USER_ID);
      expect(storage.deleteDocument).toHaveBeenCalledWith(KEY);

      const [deleted] = repository.softDelete.mock.invocationCallOrder;
      const [removed] = storage.deleteDocument.mock.invocationCallOrder;
      expect(deleted).toBeLessThan(removed);
    });

    it('answers REPORT_NOT_FOUND and touches no file when the history does not list it', async () => {
      repository.softDelete.mockResolvedValue(false);

      await expectNotFound(service.remove(USER_ID, REPORT_ID));
      expect(storage.deleteDocument).not.toHaveBeenCalled();
    });

    it('only logs when the file cannot be deleted', async () => {
      storage.deleteDocument.mockRejectedValue(new Error('bucket unavailable'));

      await expect(service.remove(USER_ID, REPORT_ID)).resolves.toBeUndefined();
      expect(logError).toHaveBeenCalledTimes(1);
    });
  });
});
