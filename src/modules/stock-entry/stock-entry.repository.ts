import { Injectable } from '@nestjs/common';
import { Prisma, PurchaseInvoice } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

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

/** The module's only point of contact with the database (ADR-01). */
@Injectable()
export class StockEntryRepository {
  constructor(private readonly prisma: PrismaService) {}

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
