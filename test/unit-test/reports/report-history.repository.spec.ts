import { ReportKind, ReportStatus } from '@prisma/client';

import { PrismaService } from '../../../src/infra/prisma/prisma.service';
import { ReportHistoryRepository } from '../../../src/modules/reports/report-history.repository';

const USER_ID = '0b9f6c1e-7d2a-4f3b-8c5d-1a2b3c4d5e6f';
const REPORT_ID = '5f3b7d0c-2a1e-4c7b-9a11-1f2e3d4c5b6a';

describe('ReportHistoryRepository recording', () => {
  let report: { create: jest.Mock; updateMany: jest.Mock };
  let repository: ReportHistoryRepository;

  beforeEach(() => {
    report = {
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    repository = new ReportHistoryRepository({
      report,
    } as unknown as PrismaService);
  });

  it('creates the row PENDING, with the key in file_url', async () => {
    await repository.createPending({
      id: REPORT_ID,
      userId: USER_ID,
      kind: ReportKind.GENERAL_REPORT,
      periodStart: new Date('2026-10-15'),
      periodEnd: new Date('2026-11-14'),
      filters: { sections: ['FINANCIAL'] },
      fileKey: `users/${USER_ID}/reports/${REPORT_ID}/original`,
      fileName: 'report.pdf',
      fileBytesSize: 1024,
    });

    expect(report.create).toHaveBeenCalledWith({
      data: {
        id: REPORT_ID,
        userId: USER_ID,
        kind: ReportKind.GENERAL_REPORT,
        periodStart: new Date('2026-10-15'),
        periodEnd: new Date('2026-11-14'),
        filters: { sections: ['FINANCIAL'] },
        fileUrl: `users/${USER_ID}/reports/${REPORT_ID}/original`,
        fileName: 'report.pdf',
        fileBytesSize: 1024,
        status: ReportStatus.PENDING,
      },
    });
  });

  it.each([
    ['markDone', ReportStatus.DONE],
    ['markFailed', ReportStatus.FAILED],
  ] as const)(
    '%s only moves a PENDING row of the user',
    async (method, status) => {
      await expect(repository[method](REPORT_ID, USER_ID)).resolves.toBe(true);

      expect(report.updateMany).toHaveBeenCalledWith({
        where: { id: REPORT_ID, userId: USER_ID, status: ReportStatus.PENDING },
        data: { status },
      });
    },
  );

  it('answers false when the row was not PENDING', async () => {
    report.updateMany.mockResolvedValue({ count: 0 });

    await expect(repository.markDone(REPORT_ID, USER_ID)).resolves.toBe(false);
  });
});
