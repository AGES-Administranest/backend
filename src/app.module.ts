import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './infra/prisma/prisma.module';
import { AuthModule } from './modules/auth';
import { ItemModule } from './modules/item/item.module';
import { UsersModule } from './modules/users/users.module';
import { JwtAuthGuard, SharedAuthModule } from './shared/auth';

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
    SharedAuthModule,
    UsersModule,
    ItemModule,
    AuthModule,
  ],
  controllers: [AppController],
  // The guard is assembled here, and not in SharedAuthModule, because this is
  // the module that can see both halves of it: the verifier and cache from
  // `shared/auth`, and the resolver token from `UsersModule`.
  providers: [AppService, JwtAuthGuard],
})
export class AppModule {}
