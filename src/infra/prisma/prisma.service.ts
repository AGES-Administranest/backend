import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
      // Opt-in SQL log. The e2e suite turns it on to count the statements a
      // request runs (proof there is no N+1); it is also handy when debugging
      // locally. Off by default: it is noisy.
      log:
        process.env.PRISMA_LOG_QUERIES === 'true'
          ? [{ emit: 'event', level: 'query' }]
          : [],
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  // Without this the pool keeps its sockets open: the process lingers on
  // shutdown, and a test run never exits on its own.
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
