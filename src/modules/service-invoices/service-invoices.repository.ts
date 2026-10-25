import { Injectable } from '@nestjs/common';
import { Prisma, ServiceInvoice, ServiceInvoiceStatus } from '@prisma/client';

import { DuplicateCriteria } from './domain/find-duplicates';
import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

export type DuplicateNote = ServiceInvoice & {
  client: { name: string } | null;
};

export type ServiceInvoiceFilters = {
  status?: ServiceInvoiceStatus;
  issuedFrom?: Date;
  issuedTo?: Date;
};

/** The module's only point of contact with the database (ADR-01). */
@Injectable()
export class ServiceInvoicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The id comes from the client (ADR-09): `userId` is the ownership check. */
  findByIdAndUser(id: string, userId: string): Promise<ServiceInvoice | null> {
    return runQuery(() =>
      this.prisma.serviceInvoice.findFirst({
        where: { id, userId, deletedAt: null },
      }),
    );
  }

  /** A discarded draft only shows up when asked for by its status. */
  findPage(
    userId: string,
    filters: ServiceInvoiceFilters,
    skip: number,
    take: number,
  ): Promise<ServiceInvoice[]> {
    return runQuery(() =>
      this.prisma.serviceInvoice.findMany({
        where: {
          userId,
          deletedAt: null,
          status: filters.status ?? { not: 'CANCELLED' },
          ...((filters.issuedFrom || filters.issuedTo) && {
            issueDate: { gte: filters.issuedFrom, lte: filters.issuedTo },
          }),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
    );
  }

  /** A deleted note no longer holds its file (partial unique). */
  async findIdByFileHash(
    userId: string,
    fileHash: string,
  ): Promise<string | undefined> {
    const invoice = await runQuery(() =>
      this.prisma.serviceInvoice.findFirst({
        where: { userId, fileHash, deletedAt: null },
        select: { id: true },
      }),
    );
    return invoice?.id;
  }

  /**
   * The latest confirmed note that looks like this one. Drafts do not count:
   * an abandoned upload would warn about a note that was never registered.
   */
  findDuplicate(
    userId: string,
    excludeId: string,
    { amountAndDate, numberAndTaker }: DuplicateCriteria,
  ): Promise<DuplicateNote | null> {
    const sameTaker = numberAndTaker && [
      ...(numberAndTaker.clientId
        ? [{ clientId: numberAndTaker.clientId }]
        : []),
      ...(numberAndTaker.takerTaxId
        ? [{ takerTaxId: numberAndTaker.takerTaxId }]
        : []),
    ];
    return runQuery(() =>
      this.prisma.serviceInvoice.findFirst({
        where: {
          userId,
          id: { not: excludeId },
          status: 'CONFIRMED',
          deletedAt: null,
          OR: [
            ...(amountAndDate ? [amountAndDate] : []),
            ...(numberAndTaker
              ? [{ number: numberAndTaker.number, OR: sameTaker }]
              : []),
          ],
        },
        include: { client: { select: { name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  }

  /**
   * Writes to the note only while it is still this user's draft, and says
   * whether it did. The check is the write's own `where`, so a note discarded
   * after the service looked at it is left alone.
   */
  async updateDraft(
    id: string,
    userId: string,
    data: Prisma.ServiceInvoiceUncheckedUpdateManyInput,
  ): Promise<boolean> {
    const { count } = await runQuery(() =>
      this.prisma.serviceInvoice.updateMany({
        where: { id, userId, status: 'DRAFT', deletedAt: null },
        data: { ...data, updatedAt: new Date() },
      }),
    );
    return count === 1;
  }

  create(data: Prisma.ServiceInvoiceUncheckedCreateInput) {
    return runQuery(() => this.prisma.serviceInvoice.create({ data }));
  }

  update(id: string, data: Prisma.ServiceInvoiceUncheckedUpdateInput) {
    return runQuery(() =>
      this.prisma.serviceInvoice.update({ where: { id }, data }),
    );
  }

  /**
   * Moves a draft waiting for a reading to PROCESSING, and says whether this
   * call did it: of two confirmations racing, only one reads the file. A
   * PROCESSING older than `staleBefore` was left by a process that died.
   */
  async claimExtraction(id: string, staleBefore: Date): Promise<boolean> {
    const { count } = await runQuery(() =>
      this.prisma.serviceInvoice.updateMany({
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
