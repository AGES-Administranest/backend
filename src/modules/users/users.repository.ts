import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * Único ponto do módulo que fala com o banco (ADR-01).
 *
 * Regras:
 * - só fala de dados; nenhuma regra de negócio mora aqui;
 * - é privado do módulo — não é exportado no `index.ts`, ninguém de fora injeta;
 * - todo método passa por `runQuery`, então o erro que sai daqui já tem nome
 *   (`UniqueConstraintError`) em vez de código do Prisma (`P2002`).
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMany(): Promise<User[]> {
    return runQuery(() =>
      this.prisma.user.findMany({ orderBy: { createdAt: 'desc' } }),
    );
  }

  findById(id: string): Promise<User | null> {
    return runQuery(() => this.prisma.user.findUnique({ where: { id } }));
  }

  create(data: Prisma.UserCreateInput): Promise<User> {
    return runQuery(() => this.prisma.user.create({ data }));
  }

  update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return runQuery(() => this.prisma.user.update({ where: { id }, data }));
  }

  delete(id: string): Promise<User> {
    return runQuery(() => this.prisma.user.delete({ where: { id } }));
  }
}
