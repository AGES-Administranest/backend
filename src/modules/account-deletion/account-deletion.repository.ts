import { Injectable } from '@nestjs/common';
import { AccountDeletion } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * The deletion touches every table that has an owner, so unlike the other
 * repositories (ADR-01) this one is not about a single entity. It is still the
 * only place in the module that talks to the database, and it is private to it.
 */
@Injectable()
export class AccountDeletionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUserIdByCognitoSub(cognitoSub: string): Promise<string | null> {
    const user = await runQuery(() =>
      this.prisma.user.findUnique({
        where: { cognitoSub },
        select: { id: true },
      }),
    );
    return user?.id ?? null;
  }

  findByCognitoSubHash(
    cognitoSubHash: string,
  ): Promise<AccountDeletion | null> {
    return runQuery(() =>
      this.prisma.accountDeletion.findUnique({ where: { cognitoSubHash } }),
    );
  }

  /**
   * Removes the user and everything they own, and writes the audit row, in one
   * transaction: a failure anywhere leaves the account exactly as it was.
   *
   * Rows with `deleted_at` set go too — a soft delete hides a row from the
   * user, it does not stop it being their personal data.
   *
   * Children first. No foreign key cascades (every relation is Restrict or
   * SetNull), so the order below is what keeps the constraints satisfied; the
   * self-references of `stock_movement` need no order of their own because
   * they die in the same statement.
   */
  purge(
    userId: string,
    audit: { cognitoSubHash: string; retentionBasis: string },
  ): Promise<AccountDeletion> {
    return runQuery(() =>
      this.prisma.$transaction(
        async tx => {
          await tx.financialEntry.deleteMany({ where: { userId } });
          await tx.stockMovement.deleteMany({ where: { userId } });
          await tx.purchaseInvoiceLine.deleteMany({
            where: { purchaseInvoice: { userId } },
          });
          await tx.itemLot.deleteMany({ where: { item: { userId } } });
          await tx.purchaseInvoice.deleteMany({ where: { userId } });
          await tx.serviceInvoice.deleteMany({ where: { userId } });
          await tx.purchaseOrder.deleteMany({ where: { userId } });
          await tx.trip.deleteMany({ where: { userId } });
          await tx.appointment.deleteMany({ where: { userId } });
          await tx.vehicle.deleteMany({ where: { userId } });
          await tx.equipment.deleteMany({ where: { userId } });
          await tx.item.deleteMany({ where: { userId } });
          await tx.supplier.deleteMany({ where: { userId } });
          await tx.client.deleteMany({ where: { userId } });
          // The user's own categories only: `userId: null` are the defaults
          // everybody shares, and `{ userId }` never matches them.
          await tx.financialCategory.deleteMany({ where: { userId } });
          await tx.report.deleteMany({ where: { userId } });
          await tx.pricingSettings.deleteMany({ where: { userId } });
          await tx.hourlyRateSnapshot.deleteMany({ where: { userId } });

          // `delete`, not `deleteMany`: if a concurrent request already took
          // the user, this throws and the whole transaction rolls back.
          await tx.user.delete({ where: { id: userId } });

          // `upsert` on the hash and not `create`: an account can be deleted
          // twice under the same Cognito sub, when a login that raced the
          // first deletion rebuilt the mirror. The second deletion takes over
          // the row and reopens the pending steps, because the new user's
          // files and login still have to go.
          return tx.accountDeletion.upsert({
            where: { cognitoSubHash: audit.cognitoSubHash },
            create: { userId, ...audit },
            update: {
              userId,
              retentionBasis: audit.retentionBasis,
              deletedAt: new Date(),
              storagePurgedAt: null,
              identityRemovedAt: null,
            },
          });
        },
        // A long history is a lot of rows; the 5 s default is for short work.
        { maxWait: 10_000, timeout: 60_000 },
      ),
    );
  }

  markStoragePurged(userId: string): Promise<AccountDeletion> {
    return runQuery(() =>
      this.prisma.accountDeletion.update({
        where: { userId },
        data: { storagePurgedAt: new Date() },
      }),
    );
  }

  markIdentityRemoved(userId: string): Promise<AccountDeletion> {
    return runQuery(() =>
      this.prisma.accountDeletion.update({
        where: { userId },
        data: { identityRemovedAt: new Date() },
      }),
    );
  }
}
