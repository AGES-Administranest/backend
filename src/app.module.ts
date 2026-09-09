import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './infra/prisma/prisma.module';
import { StorageModule } from './infra/storage';
import { AuthModule } from './modules/auth';
import { StockEntryModule } from './modules/stock-entry';
import { UsersModule } from './modules/users/users.module';
import { DevAuthMiddleware } from './shared/auth';

@Module({
  imports: [
    // O .aws-local.env é gerado pelo `npm run dev:bootstrap` com os IDs do
    // Cognito e do S3 emulados (ver docs/ambiente-local.md). Em produção ele
    // não existe, e o ConfigModule ignora arquivo ausente sem reclamar.
    // Ordem importa: em caso de chave repetida, o PRIMEIRO arquivo vence.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.aws-local.env'],
    }),
    PrismaModule,
    StorageModule,
    UsersModule,
    AuthModule,
    StockEntryModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  /** TEMPORARY — goes away with `DevAuthMiddleware` (US34 subtask 2). */
  configure(consumer: MiddlewareConsumer) {
    const bypass = process.env.DEV_AUTH_BYPASS === 'true';
    const isProduction = process.env.NODE_ENV === 'production';
    if (!bypass || isProduction) return;

    consumer.apply(DevAuthMiddleware).forRoutes('{*path}');
  }
}
