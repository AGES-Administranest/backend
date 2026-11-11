import { Injectable } from '@nestjs/common';
import { Prisma, ServiceInvoice } from '@prisma/client';

import { DuplicateCriteria } from './domain/find-duplicates';
import { escapeLike, InvoiceSearch } from './domain/search';
import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Period } from '../../shared/dates/period';

/** A write to the note's income entry, inside the note's transaction. */
export type IncomeWrite<Result> = (
  tx: Prisma.TransactionClient,
  note: ServiceInvoice,
) => Promise<Result>;

export type DuplicateNote = ServiceInvoice & {
  client: { name: string } | null;
};

/** A confirmed note with the client it was issued to. */
export type ListedNote = ServiceInvoice & {
  client: { id: string; name: string } | null;
};

export type NotePage = { notes: ListedNote[]; total: number };

export type ClientSummary = { id: string; name: string; taxId: string | null };

/** A confirmed note with what the Reports list shows of its taker. */
export type ReportNote = Pick<
  ServiceInvoice,
  'id' | 'issueDate' | 'fileUrl'
> & {
  client: { name: string } | null;
};

export type ReportFilters = {
  search?: string;
  issuedFrom?: Date;
  issuedTo?: Date;
};

/** The module's only point of contact with the database (ADR-01). */
@Injectable()
export class ServiceInvoicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Confirmed service invoices issued in the period. A draft is not a record yet. */
  countConfirmedInPeriod(userId: string, period: Period): Promise<number> {
    return runQuery(() =>
      this.prisma.serviceInvoice.count({
        where: {
          userId,
          deletedAt: null,
          status: 'CONFIRMED',
          issueDate: { gte: period.days.from, lt: period.days.to },
        },
      }),
    );
  }

  /** The id comes from the client (ADR-09): `userId` is the ownership check. */
  findByIdAndUser(id: string, userId: string): Promise<ServiceInvoice | null> {
    return runQuery(() =>
      this.prisma.serviceInvoice.findFirst({
        where: { id, userId, deletedAt: null },
      }),
    );
  }

  /**
   * The user's confirmed notes, newest issue date first. The search is raw SQL
   * because Prisma cannot compare without accents (`unaccent`) nor against a
   * date written as `DD/MM/YYYY`; the rows themselves are read back through
   * Prisma, in the order the ids came out.
   */
  findConfirmedPage(
    userId: string,
    search: InvoiceSearch | null,
    skip: number,
    take: number,
  ): Promise<NotePage> {
    const matching = Prisma.sql`
      FROM service_invoice AS note
      LEFT JOIN client ON client.id = note.client_id
      WHERE note.user_id = ${userId}::uuid
        AND note.status = 'CONFIRMED'
        AND note.deleted_at IS NULL
        ${search ? Prisma.sql`AND ${searchCondition(search)}` : Prisma.empty}`;

    return runQuery(async () => {
      const [rows, counted] = await Promise.all([
        this.prisma.$queryRaw<{ id: string }[]>`
          SELECT note.id ${matching}
          ORDER BY note.issue_date DESC, note.id DESC
          LIMIT ${take} OFFSET ${skip}`,
        this.prisma.$queryRaw<{ total: bigint }[]>`
          SELECT COUNT(*) AS total ${matching}`,
      ]);

      const ids = rows.map(row => row.id);
      const notes = await this.prisma.serviceInvoice.findMany({
        where: { id: { in: ids }, userId },
        include: { client: { select: { id: true, name: true } } },
      });
      const byId = new Map(notes.map(note => [note.id, note]));

      return {
        notes: ids.flatMap(id => byId.get(id) ?? []),
        total: Number(counted[0]?.total ?? 0),
      };
    });
  }

  /**
   * The taker as the note shows it. A client deleted since the note was
   * confirmed still shows: the note keeps the name it was issued to. The
   * `userId` is the ownership check, as everywhere else.
   */
  findClientSummary(
    clientId: string,
    userId: string,
  ): Promise<ClientSummary | null> {
    return runQuery(() =>
      this.prisma.client.findFirst({
        where: { id: clientId, userId },
        select: { id: true, name: true, taxId: true },
      }),
    );
  }

  /**
   * Confirmed notes only: they are the ones with an issue date and a taker the
   * user picked. Latest issue date first; the rest keeps the order stable
   * between pages.
   */
  findConfirmedForReport(
    userId: string,
    filters: ReportFilters,
    skip: number,
    take: number,
  ): Promise<ReportNote[]> {
    return runQuery(() =>
      this.prisma.serviceInvoice.findMany({
        where: {
          userId,
          deletedAt: null,
          status: 'CONFIRMED',
          ...((filters.issuedFrom || filters.issuedTo) && {
            issueDate: { gte: filters.issuedFrom, lte: filters.issuedTo },
          }),
          ...(filters.search && {
            client: {
              name: {
                contains: escapeLike(filters.search),
                mode: 'insensitive',
              },
            },
          }),
        },
        select: {
          id: true,
          issueDate: true,
          fileUrl: true,
          client: { select: { name: true } },
        },
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
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
   * DRAFT → CONFIRMED, then `recordIncome`, in one transaction. Answers what
   * `recordIncome` returned, or null when the note was not this user's draft.
   */
  confirmDraft(
    id: string,
    userId: string,
    changes: Prisma.ServiceInvoiceUncheckedUpdateManyInput,
    recordIncome: IncomeWrite<string>,
  ): Promise<string | null> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const confirmed = await this.updateInStatus(tx, id, userId, 'DRAFT', {
          ...changes,
          status: 'CONFIRMED',
          reviewedAt: new Date(),
        });
        if (!confirmed) return null;

        return recordIncome(tx, confirmed);
      }),
    );
  }

  /** Edits a confirmed note, then `adjustIncome`, in one transaction. */
  updateConfirmed(
    id: string,
    userId: string,
    data: Prisma.ServiceInvoiceUncheckedUpdateManyInput,
    adjustIncome: IncomeWrite<void>,
  ): Promise<boolean> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const edited = await this.updateInStatus(
          tx,
          id,
          userId,
          'CONFIRMED',
          data,
        );
        if (!edited) return false;

        await adjustIncome(tx, edited);
        return true;
      }),
    );
  }

  /**
   * Soft deletes a confirmed note, then `removeIncome`, in one transaction.
   * The partial unique on the file hash ignores deleted notes, so the same
   * file can be uploaded again.
   */
  deleteConfirmed(
    id: string,
    userId: string,
    removeIncome: IncomeWrite<void>,
  ): Promise<boolean> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const deleted = await this.updateInStatus(tx, id, userId, 'CONFIRMED', {
          deletedAt: new Date(),
        });
        if (!deleted) return false;

        await removeIncome(tx, deleted);
        return true;
      }),
    );
  }

  /**
   * Updates this user's note only if it is still in `status`, and answers it
   * as updated, or null. The status is checked by the update's own `where`:
   * a concurrent change waits on the row lock and then matches nothing.
   */
  private async updateInStatus(
    tx: Prisma.TransactionClient,
    id: string,
    userId: string,
    status: 'DRAFT' | 'CONFIRMED',
    data: Prisma.ServiceInvoiceUncheckedUpdateManyInput,
  ): Promise<ServiceInvoice | null> {
    const { count } = await tx.serviceInvoice.updateMany({
      where: { id, userId, status, deletedAt: null },
      data: { ...data, updatedAt: new Date() },
    });
    if (count === 0) return null;

    return tx.serviceInvoice.findUniqueOrThrow({ where: { id } });
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

/**
 * The three things a search can mean. The date is compared by its digits, so
 * `22/04` and `2204` are the same search and either finds 22/04/2026.
 */
function searchCondition({ text, dateDigits }: InvoiceSearch): Prisma.Sql {
  const like = `%${escapeLike(text)}%`;
  const byDate = dateDigits
    ? Prisma.sql`OR to_char(note.issue_date, 'DDMMYYYY') LIKE ${`%${dateDigits}%`}`
    : Prisma.empty;

  return Prisma.sql`(
    unaccent(client.name) ILIKE unaccent(${like})
    OR unaccent(note.number) ILIKE unaccent(${like})
    ${byDate}
  )`;
}
