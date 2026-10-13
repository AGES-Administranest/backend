// TODO(US15): temporary, with monthly-depreciation.ts. Goes away when the
// official equipment module owns this read.
import { Injectable } from '@nestjs/common';

import type { DepreciableEquipment } from './monthly-depreciation';
import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** Every read is scoped to the owner (ADR-11) and skips rows with deleted_at. */
@Injectable()
export class MonthlyDepreciationRepository {
  constructor(private readonly prisma: PrismaService) {}

  findDepreciable(userId: string): Promise<DepreciableEquipment[]> {
    return runQuery(() =>
      this.prisma.equipment.findMany({
        where: { userId, active: true, deletedAt: null },
        select: {
          purchaseValue: true,
          salvageValue: true,
          acquisitionDate: true,
          usefulLifeYears: true,
        },
      }),
    );
  }
}
