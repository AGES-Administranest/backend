import { INestApplication } from '@nestjs/common';
import { Prisma, ReportKind, ReportStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';

import {
  bearer,
  body,
  createTestApp,
  mintTokens,
  TestUser,
} from './helpers/test-app';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import {
  DocumentStorage,
  PresignedGet,
  PresignedGetRequest,
  PresignedPost,
  StoredDocument,
} from '../src/infra/storage';
import { ReportArchiveService } from '../src/modules/reports';

/**
 * The bucket, in memory: CI has no S3, and the spec reads back what was put
 * and deleted. Each write can be made to fail once.
 */
class MemoryStorage extends DocumentStorage {
  readonly objects = new Map<string, { body: Uint8Array; type: string }>();
  failNextPut = false;
  failNextDelete = false;

  createPresignedPost(): Promise<PresignedPost> {
    return Promise.resolve({ url: 'https://bucket', fields: {}, expiresAt: 0 });
  }

  headDocument(key: string): Promise<StoredDocument | null> {
    const object = this.objects.get(key);
    return Promise.resolve(
      object
        ? { contentLength: object.body.byteLength, contentType: object.type }
        : null,
    );
  }

  getDocument(key: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.objects.get(key)?.body ?? null);
  }

  putDocument(key: string, bytes: Uint8Array, type: string): Promise<void> {
    if (this.failNextPut) {
      this.failNextPut = false;
      return Promise.reject(new Error('bucket unavailable'));
    }
    this.objects.set(key, { body: bytes, type });
    return Promise.resolve();
  }

  deleteDocument(key: string): Promise<void> {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      return Promise.reject(new Error('bucket unavailable'));
    }
    this.objects.delete(key);
    return Promise.resolve();
  }

  createPresignedGet(request: PresignedGetRequest): Promise<PresignedGet> {
    const name = request.fileName ? `?name=${request.fileName}` : '';
    return Promise.resolve({
      url: `https://bucket/${request.key}${name}`,
      expiresAt: Date.now() + request.expiresInMs,
    });
  }
}

interface HistoryItem {
  id: string;
  kind: ReportKind;
  fileName: string | null;
  fileBytesSize: number | null;
  period: { from: string; to: string } | null;
  generatedAt: string;
}

const PDF = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);

/**
 * The history of generated reports (US32) against a real database: the list,
 * the download link, the delete, and how a generated file is recorded.
 *
 * The rows are created once, with fixed `created_at` values, so the order is
 * known. A test that deletes or records a report undoes it in a `finally`, so
 * the next one still sees the same history.
 */
describe('Report history (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const storage = new MemoryStorage();

  const owner: TestUser = {
    cognitoSub: `e2e-history-${randomUUID()}`,
    email: `e2e-history-${randomUUID()}@example.com`,
    name: 'Ana Souza',
  };
  const other: TestUser = {
    cognitoSub: `e2e-history-other-${randomUUID()}`,
    email: `e2e-history-other-${randomUUID()}@example.com`,
    name: 'Bruno Lima',
  };
  const empty: TestUser = {
    cognitoSub: `e2e-history-empty-${randomUUID()}`,
    email: `e2e-history-empty-${randomUUID()}@example.com`,
    name: 'Bia Lima',
  };

  let ownerId: string;
  let otherId: string;

  // The owner's listed reports, newest first. `tieA` and `tieB` share their
  // `created_at`, so the id decides their order (descending): `tieB` is the
  // greater of two fresh ids, so a rerun on the same database never collides.
  const [tieA, tieB] = [randomUUID(), randomUUID()].sort();
  const listed = {
    newest: randomUUID(),
    tax: randomUUID(),
    tieA,
    tieB,
    oldest: randomUUID(),
  };
  const pending = randomUUID();
  const failed = randomUUID();
  const deleted = randomUUID();
  const othersReport = randomUUID();

  const server = () => app.getHttpServer();
  const keyOf = (userId: string, id: string) =>
    `users/${userId}/reports/${id}/original`;

  const list = (user: TestUser, query: object = {}) =>
    request(server())
      .get('/reports')
      .query(query)
      .set('Authorization', bearer(user));
  const file = (user: TestUser, id: string) =>
    request(server())
      .get(`/reports/${id}/file`)
      .set('Authorization', bearer(user));
  const remove = (user: TestUser, id: string) =>
    request(server())
      .delete(`/reports/${id}`)
      .set('Authorization', bearer(user));

  const idsOf = (response: { body: unknown }) =>
    (response.body as HistoryItem[]).map(item => item.id);
  const readRow = (id: string) =>
    prisma.report.findUniqueOrThrow({ where: { id } });

  /** A stored report, its object in the bucket. */
  const seedReport = async (
    userId: string,
    id: string,
    data: Partial<Prisma.ReportUncheckedCreateInput> = {},
  ) => {
    await prisma.report.create({
      data: {
        id,
        userId,
        kind: ReportKind.GENERAL_REPORT,
        periodStart: new Date('2026-10-15'),
        periodEnd: new Date('2026-11-14'),
        filters: { sections: ['FINANCIAL'] },
        fileUrl: keyOf(userId, id),
        fileName: `report-${id}.pdf`,
        fileBytesSize: PDF.byteLength,
        status: ReportStatus.DONE,
        ...data,
      },
    });
    storage.objects.set(keyOf(userId, id), {
      body: PDF,
      type: 'application/pdf',
    });
  };

  /** Puts a deleted report back in the history, with its file. */
  const restore = async (userId: string, id: string) => {
    await prisma.report.update({
      where: { id },
      data: { deletedAt: null },
    });
    storage.objects.set(keyOf(userId, id), {
      body: PDF,
      type: 'application/pdf',
    });
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp(builder =>
      builder.overrideProvider(DocumentStorage).useValue(storage),
    ));
    await mintTokens([owner, other, empty]);

    const provision = async (user: TestUser) => {
      const session = await request(server())
        .post('/auth/session')
        .set('Authorization', bearer(user))
        .expect(200);
      return (session.body as { id: string }).id;
    };
    ownerId = await provision(owner);
    otherId = await provision(other);
    await provision(empty);

    await seedReport(ownerId, listed.newest, {
      createdAt: new Date('2026-11-12T18:00:00Z'),
      fileName: 'administranest_relatorio-geral_2026-10-15_2026-11-14.pdf',
      fileBytesSize: 184320,
    });
    await seedReport(ownerId, listed.tax, {
      kind: ReportKind.TAX_PACKAGE,
      createdAt: new Date('2026-11-11T18:00:00Z'),
      filters: {},
      fileName: 'administranest_pacote-contabil_2026-10-01_2026-10-31.zip',
      periodStart: new Date('2026-10-01'),
      periodEnd: new Date('2026-10-31'),
    });
    await seedReport(ownerId, listed.tieA, {
      createdAt: new Date('2026-11-10T18:00:00Z'),
    });
    await seedReport(ownerId, listed.tieB, {
      createdAt: new Date('2026-11-10T18:00:00Z'),
    });
    await seedReport(ownerId, listed.oldest, {
      createdAt: new Date('2026-11-01T18:00:00Z'),
    });

    // Never listed: still being stored, failed, or deleted. All of them are
    // newer than everything above, so leaving them out is not an accident of
    // the page.
    await seedReport(ownerId, pending, {
      status: ReportStatus.PENDING,
      createdAt: new Date('2026-11-12T19:00:00Z'),
    });
    await seedReport(ownerId, failed, {
      status: ReportStatus.FAILED,
      createdAt: new Date('2026-11-12T19:00:00Z'),
    });
    await seedReport(ownerId, deleted, {
      deletedAt: new Date('2026-11-12T19:30:00Z'),
      createdAt: new Date('2026-11-12T19:00:00Z'),
    });

    await seedReport(otherId, othersReport, {
      createdAt: new Date('2026-11-12T20:00:00Z'),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /reports', () => {
    it('lists the stored reports, newest first, and the id breaks a tie', async () => {
      const response = await list(owner).expect(200);

      expect(idsOf(response)).toEqual([
        listed.newest,
        listed.tax,
        listed.tieB,
        listed.tieA,
        listed.oldest,
      ]);
    });

    it('answers what the history shows of each report, and nothing else', async () => {
      const response = await list(owner, { limit: 1 }).expect(200);

      expect(response.body).toEqual([
        {
          id: listed.newest,
          kind: 'GENERAL_REPORT',
          fileName: 'administranest_relatorio-geral_2026-10-15_2026-11-14.pdf',
          fileBytesSize: 184320,
          period: { from: '2026-10-15', to: '2026-11-14' },
          generatedAt: '2026-11-12T18:00:00.000Z',
        },
      ]);
    });

    it('pages without repeating or skipping a report; a short page is the last', async () => {
      const pages = await Promise.all(
        [1, 2, 3].map(page => list(owner, { page, limit: 2 }).expect(200)),
      );

      expect(pages.map(idsOf)).toEqual([
        [listed.newest, listed.tax],
        [listed.tieB, listed.tieA],
        [listed.oldest],
      ]);
      expect(
        idsOf(await list(owner, { page: 4, limit: 2 }).expect(200)),
      ).toEqual([]);
    });

    it('filters by kind', async () => {
      const taxes = await list(owner, { kind: 'TAX_PACKAGE' }).expect(200);
      const general = await list(owner, { kind: 'GENERAL_REPORT' }).expect(200);

      expect(idsOf(taxes)).toEqual([listed.tax]);
      expect(idsOf(general)).toEqual([
        listed.newest,
        listed.tieB,
        listed.tieA,
        listed.oldest,
      ]);
    });

    it('answers an empty list to an account that generated nothing', async () => {
      expect((await list(empty).expect(200)).body).toEqual([]);
    });

    it.each([
      [{ kind: 'PDF' }],
      [{ limit: 101 }],
      [{ page: 0 }],
      [{ userId: randomUUID() }],
    ])('refuses %p', async query => {
      const response = await list(owner, query).expect(400);

      expect(body(response)).toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('requires a token', async () => {
      await request(server()).get('/reports').expect(401);
    });
  });

  describe('GET /reports/:id/file', () => {
    it('answers a five-minute link to the file, under its name', async () => {
      const before = Date.now();

      const response = await file(owner, listed.newest).expect(200);

      const link = body(response) as { url: string; expiresAt: number };
      expect(link.url).toBe(
        `https://bucket/${keyOf(ownerId, listed.newest)}` +
          '?name=administranest_relatorio-geral_2026-10-15_2026-11-14.pdf',
      );
      expect(link.expiresAt).toBeGreaterThanOrEqual(before + 5 * 60 * 1000);
      expect(link.expiresAt).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000);
    });

    it.each([
      ['still being stored', () => pending],
      ['that failed', () => failed],
      ['deleted', () => deleted],
      ['of another account', () => othersReport],
      ['that does not exist', () => randomUUID()],
    ])('answers 404 for a report %s', async (_case, id) => {
      const response = await file(owner, id()).expect(404);

      expect(body(response)).toMatchObject({ code: 'REPORT_NOT_FOUND' });
    });

    it('answers 400 for an id that is not a UUID', async () => {
      await file(owner, 'not-a-uuid').expect(400);
    });

    it('requires a token', async () => {
      await request(server()).get(`/reports/${listed.newest}/file`).expect(401);
    });
  });

  describe('DELETE /reports/:id', () => {
    it('removes the report from the history and its file from the bucket', async () => {
      try {
        await remove(owner, listed.oldest).expect(204);

        const row = await readRow(listed.oldest);
        expect(row.deletedAt).toBeInstanceOf(Date);
        expect(row.fileUrl).toBe(keyOf(ownerId, listed.oldest));
        expect(storage.objects.has(keyOf(ownerId, listed.oldest))).toBe(false);
        expect(idsOf(await list(owner).expect(200))).not.toContain(
          listed.oldest,
        );
        await file(owner, listed.oldest).expect(404);
      } finally {
        await restore(ownerId, listed.oldest);
      }
    });

    it('answers 404 to a second delete', async () => {
      try {
        await remove(owner, listed.oldest).expect(204);

        const response = await remove(owner, listed.oldest).expect(404);

        expect(body(response)).toMatchObject({ code: 'REPORT_NOT_FOUND' });
      } finally {
        await restore(ownerId, listed.oldest);
      }
    });

    it('still deletes the report when the bucket fails, and keeps the key', async () => {
      storage.failNextDelete = true;
      try {
        await remove(owner, listed.oldest).expect(204);

        const row = await readRow(listed.oldest);
        expect(row.deletedAt).toBeInstanceOf(Date);
        expect(row.fileUrl).toBe(keyOf(ownerId, listed.oldest));
        expect(idsOf(await list(owner).expect(200))).not.toContain(
          listed.oldest,
        );
      } finally {
        storage.failNextDelete = false;
        await restore(ownerId, listed.oldest);
      }
    });

    it.each([
      ['still being stored', () => pending, ReportStatus.PENDING],
      ['that failed', () => failed, ReportStatus.FAILED],
    ])(
      'answers 404 for a report %s and leaves it as it was',
      async (_case, id, status) => {
        const response = await remove(owner, id()).expect(404);

        expect(body(response)).toMatchObject({ code: 'REPORT_NOT_FOUND' });
        const row = await readRow(id());
        expect(row).toMatchObject({ status, deletedAt: null });
        expect(storage.objects.has(keyOf(ownerId, id()))).toBe(true);
      },
    );

    it("answers 404 for another account's report and touches nothing", async () => {
      const response = await remove(owner, othersReport).expect(404);

      expect(body(response)).toMatchObject({ code: 'REPORT_NOT_FOUND' });
      expect(await readRow(othersReport)).toMatchObject({
        status: ReportStatus.DONE,
        deletedAt: null,
      });
      expect(storage.objects.has(keyOf(otherId, othersReport))).toBe(true);
      expect(idsOf(await list(other).expect(200))).toEqual([othersReport]);
    });

    it('answers 400 for an id that is not a UUID', async () => {
      await remove(owner, 'not-a-uuid').expect(400);
    });

    it('requires a token', async () => {
      await request(server()).delete(`/reports/${listed.oldest}`).expect(401);
    });
  });

  describe('recording a generated file', () => {
    const generated = {
      kind: ReportKind.GENERAL_REPORT,
      period: { from: '2026-09-01', to: '2026-09-30' },
      filters: { sections: ['FINANCIAL', 'TRIPS'] },
      fileName: 'administranest_relatorio-geral_2026-09-01_2026-09-30.pdf',
      contentType: 'application/pdf',
      body: PDF,
    };

    const archive = () => app.get(ReportArchiveService);

    it('records the report DONE, stores its file and lists it first', async () => {
      let id: string | undefined;
      try {
        id = await archive().store(ownerId, generated);

        expect(await readRow(id)).toMatchObject({
          userId: ownerId,
          kind: ReportKind.GENERAL_REPORT,
          periodStart: new Date('2026-09-01'),
          periodEnd: new Date('2026-09-30'),
          filters: { sections: ['FINANCIAL', 'TRIPS'] },
          fileUrl: keyOf(ownerId, id),
          fileName: 'administranest_relatorio-geral_2026-09-01_2026-09-30.pdf',
          fileBytesSize: PDF.byteLength,
          status: ReportStatus.DONE,
          deletedAt: null,
        });
        expect(storage.objects.get(keyOf(ownerId, id))).toEqual({
          body: PDF,
          type: 'application/pdf',
        });

        const [first] = (await list(owner).expect(200)).body as HistoryItem[];
        expect(first).toMatchObject({
          id,
          fileName: generated.fileName,
          period: generated.period,
        });
        await file(owner, id).expect(200);
      } finally {
        if (id) {
          await prisma.report.delete({ where: { id } });
          storage.objects.delete(keyOf(ownerId, id));
        }
      }
    });

    it('records the report FAILED and fails when the upload fails', async () => {
      const before = new Set(
        (await prisma.report.findMany({ select: { id: true } })).map(
          row => row.id,
        ),
      );
      storage.failNextPut = true;
      try {
        await expect(archive().store(ownerId, generated)).rejects.toThrow(
          'bucket unavailable',
        );

        const created = (
          await prisma.report.findMany({ where: { userId: ownerId } })
        ).filter(row => !before.has(row.id));
        expect(created).toHaveLength(1);
        expect(created[0]).toMatchObject({
          status: ReportStatus.FAILED,
          fileUrl: keyOf(ownerId, created[0].id),
          fileName: generated.fileName,
          fileBytesSize: PDF.byteLength,
        });
        expect(storage.objects.has(keyOf(ownerId, created[0].id))).toBe(false);
        expect(idsOf(await list(owner).expect(200))).not.toContain(
          created[0].id,
        );
        await file(owner, created[0].id).expect(404);
      } finally {
        storage.failNextPut = false;
        await prisma.report.deleteMany({
          where: { userId: ownerId, id: { notIn: [...before] } },
        });
      }
    });
  });
});
