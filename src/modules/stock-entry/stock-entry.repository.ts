import { Injectable } from '@nestjs/common';
import { Prisma, PurchaseInvoice } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

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
