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

  update(id: string, data: Prisma.PurchaseInvoiceUpdateInput) {
    return runQuery(() =>
      this.prisma.purchaseInvoice.update({ where: { id }, data }),
    );
  }
}
