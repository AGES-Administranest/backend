import { Injectable } from '@nestjs/common';
import { Client, Prisma } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class ClientRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByName(
    userId: string,
    name: string,
    excludeId?: string,
  ): Promise<Client | null> {
    return runQuery(() =>
      this.prisma.client.findFirst({
        where: {
          userId,
          name,
          active: true,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
      }),
    );
  }

  create(data: Prisma.ClientUncheckedCreateInput): Promise<Client> {
    return runQuery(() => this.prisma.client.create({ data }));
  }

  update(
    id: string,
    userId: string,
    data: Prisma.ClientUncheckedUpdateInput,
  ): Promise<Client | null> {
    return runQuery(async () => {
      const owned = await this.prisma.client.findFirst({
        where: { id, userId },
        select: { id: true },
      });
      if (!owned) return null;
      return this.prisma.client.update({ where: { id }, data });
    });
  }
}
