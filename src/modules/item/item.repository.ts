import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma';

@Injectable()
export class ItemRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.ItemCreateInput) {
    return this.prisma.item.create({ data });
  }

  findAll(where: Prisma.ItemWhereInput = { active: true }) {
    return this.prisma.item.findMany({ where });
  }

  findOne(id: string) {
    return this.prisma.item.findUnique({ where: { id } });
  }

  update(id: string, data: Prisma.ItemUpdateInput) {
    return this.prisma.item.update({ where: { id }, data });
  }

  softDelete(id: string) {
    return this.prisma.item.update({
      where: { id },
      data: { active: false, deletedAt: new Date() },
    });
  }
}