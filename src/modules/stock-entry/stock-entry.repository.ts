import { Injectable } from '@nestjs/common';
import { Prisma, PurchaseInvoice } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Period } from '../../shared/dates/period';
import { TaxPackageTotals } from '../../shared/tax-package/tax-package.types';

const WITH_SUPPLIER_NAME = {
  supplier: { select: { name: true } },
} satisfies Prisma.PurchaseInvoiceInclude;

const WITH_LINES = {
  lines: {
    orderBy: { position: 'asc' },
    include: { item: { select: { id: true, name: true, unit: true } } },
  },
} satisfies Prisma.PurchaseInvoiceInclude;

export type InvoiceWithSupplier = Prisma.PurchaseInvoiceGetPayload<{
  include: typeof WITH_SUPPLIER_NAME;
}>;

export type InvoiceWithLines = Prisma.PurchaseInvoiceGetPayload<{
  include: typeof WITH_LINES;
}>;

export type DraftLineRow = Omit<
  Prisma.PurchaseInvoiceLineCreateManyInput,
  'purchaseInvoiceId'
>;

/** Confirmed purchase invoices, added up. One without a total adds nothing. */
export interface PurchaseTotals {
  count: number;
  total: Prisma.Decimal;
}

export interface SupplierPurchaseTotals extends PurchaseTotals {
  supplierId: string | null;
}

export type SupplierInvoiceFilters = {
  issuedFrom?: Date;
  issuedTo?: Date;
};

/**
 * `fileUrl` is filled when the upload is signed, `uploadedAt` when the app
 * confirmed it: only both together mean the file is in the bucket.
 */
const WITH_STORED_FILE = {
  fileUrl: { not: null },
  uploadedAt: { not: null },
} satisfies Prisma.PurchaseInvoiceWhereInput;

const TAX_PACKAGE_SELECT = {
  id: true,
  issueDate: true,
  totalAmount: true,
  fileName: true,
  fileMimeType: true,
  supplier: { select: { name: true } },
} satisfies Prisma.PurchaseInvoiceSelect;

export type TaxPackageInvoice = Prisma.PurchaseInvoiceGetPayload<{
  select: typeof TAX_PACKAGE_SELECT;
}>;

/** The module's only point of contact with the database (ADR-01). */
@Injectable()
export class StockEntryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Confirmed purchase invoices issued in the period. A draft is not a record yet. */
  countConfirmedInPeriod(userId: string, period: Period): Promise<number> {
    return runQuery(() =>
      this.prisma.purchaseInvoice.count({
        where: this.confirmedInPeriod(userId, period),
      }),
    );
  }

  /** The confirmed purchases of the period, added up (US29). */
  async sumConfirmedInPeriod(
    userId: string,
    period: Period,
  ): Promise<PurchaseTotals> {
    const totals = await runQuery(() =>
      this.prisma.purchaseInvoice.aggregate({
        where: this.confirmedInPeriod(userId, period),
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
    );
    return {
      count: totals._count._all,
      total: totals._sum.totalAmount ?? new Prisma.Decimal(0),
    };
  }

  /** The same purchases, by supplier; `supplierId` is null for none. */
  async sumConfirmedBySupplierInPeriod(
    userId: string,
    period: Period,
  ): Promise<SupplierPurchaseTotals[]> {
    const rows = await runQuery(() =>
      this.prisma.purchaseInvoice.groupBy({
        by: ['supplierId'],
        where: this.confirmedInPeriod(userId, period),
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
    );
    return rows.map(row => ({
      supplierId: row.supplierId,
      count: row._count._all,
      total: row._sum.totalAmount ?? new Prisma.Decimal(0),
    }));
  }

  /** What `countConfirmedInPeriod` counts. */
  private confirmedInPeriod(
    userId: string,
    period: Period,
  ): Prisma.PurchaseInvoiceWhereInput {
    return {
      userId,
      deletedAt: null,
      status: 'CONFIRMED',
      issueDate: { gte: period.days.from, lt: period.days.to },
    };
  }

  /**
   * Confirmed invoices issued in the period, split by whether their file is
   * stored. One without an issue date is in no period.
   */
  summarizeTaxPackage(
    userId: string,
    period: Period,
  ): Promise<TaxPackageTotals> {
    const confirmed = {
      userId,
      deletedAt: null,
      status: 'CONFIRMED',
      issueDate: { gte: period.days.from, lt: period.days.to },
    } satisfies Prisma.PurchaseInvoiceWhereInput;

    return runQuery(async () => {
      const [stored, missingFiles] = await Promise.all([
        this.prisma.purchaseInvoice.aggregate({
          where: { ...confirmed, ...WITH_STORED_FILE },
          _count: { _all: true },
          _sum: { totalAmount: true, fileBytesSize: true },
        }),
        this.prisma.purchaseInvoice.count({
          where: {
            ...confirmed,
            OR: [{ fileUrl: null }, { uploadedAt: null }],
          },
        }),
      ]);

      return {
        count: stored._count._all,
        totalAmount: stored._sum.totalAmount?.toNumber() ?? 0,
        bytesSize: stored._sum.fileBytesSize ?? 0,
        missingFiles,
      };
    });
  }

  /** The invoices the tax package holds, oldest first. `take` bounds the read. */
  findTaxPackageInvoices(
    userId: string,
    period: Period,
    take: number,
  ): Promise<TaxPackageInvoice[]> {
    return runQuery(() =>
      this.prisma.purchaseInvoice.findMany({
        where: {
          userId,
          deletedAt: null,
          status: 'CONFIRMED',
          issueDate: { gte: period.days.from, lt: period.days.to },
          ...WITH_STORED_FILE,
        },
        select: TAX_PACKAGE_SELECT,
        orderBy: [{ issueDate: 'asc' }, { id: 'asc' }],
        take,
      }),
    );
  }

  /** The id comes from the client (ADR-09): `userId` is the ownership check. */
  findByIdAndUser(id: string, userId: string): Promise<PurchaseInvoice | null> {
    return runQuery(() =>
      this.prisma.purchaseInvoice.findFirst({
        where: { id, userId, deletedAt: null },
      }),
    );
  }

  findDrafts(userId: string): Promise<InvoiceWithSupplier[]> {
    return runQuery(() =>
      this.prisma.purchaseInvoice.findMany({
        where: { userId, status: 'DRAFT', deletedAt: null },
        include: WITH_SUPPLIER_NAME,
        orderBy: { updatedAt: 'desc' },
      }),
    );
  }

  findConfirmedBySupplier(
    userId: string,
    supplierId: string,
    filters: SupplierInvoiceFilters,
    skip: number,
    take: number,
  ): Promise<PurchaseInvoice[]> {
    return runQuery(() =>
      this.prisma.purchaseInvoice.findMany({
        where: {
          userId,
          supplierId,
          status: 'CONFIRMED',
          deletedAt: null,
          ...((filters.issuedFrom || filters.issuedTo) && {
            issueDate: { gte: filters.issuedFrom, lte: filters.issuedTo },
          }),
        },
        orderBy: [
          { issueDate: { sort: 'desc', nulls: 'last' } },
          { id: 'desc' },
        ],
        skip,
        take,
      }),
    );
  }

  findWithLines(id: string, userId: string): Promise<InvoiceWithLines | null> {
    return runQuery(() =>
      this.prisma.purchaseInvoice.findFirst({
        where: { id, userId, deletedAt: null },
        include: WITH_LINES,
      }),
    );
  }

  async findIdByFileHash(
    userId: string,
    fileHash: string,
  ): Promise<string | undefined> {
    const invoice = await runQuery(() =>
      this.prisma.purchaseInvoice.findFirst({
        where: { userId, fileHash },
        select: { id: true },
      }),
    );
    return invoice?.id;
  }

  /**
   * Writes to the invoice only while it is still this user's draft, and says
   * whether it did. The check is the write's own `where`, so an entry
   * discarded or confirmed after the service looked at it is left alone.
   */
  confirmDraft(
    id: string,
    userId: string,
    write: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<boolean> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const { count } = await tx.purchaseInvoice.updateMany({
          where: { id, userId, status: 'DRAFT', deletedAt: null },
          data: {
            status: 'CONFIRMED',
            reviewedAt: new Date(),
            updatedAt: new Date(),
          },
        });
        if (count === 0) return false;
        await write(tx);
        return true;
      }),
    );
  }

  async updateDraft(
    id: string,
    userId: string,
    data: Prisma.PurchaseInvoiceUncheckedUpdateManyInput,
  ): Promise<boolean> {
    const { count } = await runQuery(() =>
      this.prisma.purchaseInvoice.updateMany({
        where: { id, userId, status: 'DRAFT', deletedAt: null },
        data: { ...data, updatedAt: new Date() },
      }),
    );
    return count === 1;
  }

  /**
   * The review saves every line at once: what is not sent is gone. Nothing is
   * written unless the invoice is still this user's draft, and touching it
   * first takes its row lock: a discard arriving meanwhile waits for these
   * lines, or wins before them and this answers false.
   */
  replaceLines(
    id: string,
    userId: string,
    lines: DraftLineRow[],
  ): Promise<boolean> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const { count } = await tx.purchaseInvoice.updateMany({
          where: { id, userId, status: 'DRAFT', deletedAt: null },
          data: { updatedAt: new Date() },
        });
        if (count === 0) return false;

        await tx.purchaseInvoiceLine.deleteMany({
          where: { purchaseInvoiceId: id },
        });
        await tx.purchaseInvoiceLine.createMany({
          data: lines.map(line => ({ ...line, purchaseInvoiceId: id })),
        });
        return true;
      }),
    );
  }

  create(data: Prisma.PurchaseInvoiceUncheckedCreateInput) {
    return runQuery(() => this.prisma.purchaseInvoice.create({ data }));
  }

  update(id: string, data: Prisma.PurchaseInvoiceUncheckedUpdateInput) {
    return runQuery(() =>
      this.prisma.purchaseInvoice.update({ where: { id }, data }),
    );
  }

  /**
   * Moves a draft waiting for a reading to PROCESSING, and says whether this
   * call did it: of two confirmations racing, only one reads the file. A
   * PROCESSING older than `staleBefore` was left by a process that died.
   */
  async claimExtraction(id: string, staleBefore: Date): Promise<boolean> {
    const { count } = await runQuery(() =>
      this.prisma.purchaseInvoice.updateMany({
        where: {
          id,
          status: 'DRAFT',
          deletedAt: null,
          OR: [
            { extractionStatus: { in: ['PENDING', 'FAILED'] } },
            { extractionStatus: 'PROCESSING', updatedAt: { lt: staleBefore } },
          ],
        },
        data: {
          extractionStatus: 'PROCESSING',
          failureReason: null,
          updatedAt: new Date(),
        },
      }),
    );
    return count === 1;
  }
}
