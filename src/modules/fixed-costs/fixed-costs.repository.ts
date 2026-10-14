import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** Every read is scoped to the owner (ADR-11). */
@Injectable()
export class FixedCostsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The pricing_settings row is keyed by user: no row means no transport cost. */
  async findTransportMonthly(userId: string): Promise<Prisma.Decimal | null> {
    const settings = await runQuery(() =>
      this.prisma.pricingSettings.findUnique({
        where: { userId },
        select: { transportCostMonthly: true },
      }),
    );
    return settings?.transportCostMonthly ?? null;
  }
}
