import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './infra/prisma/prisma.module';
import { AuthModule } from './modules/auth';
import { ItemModule } from './modules/item/item.module';
import { SupplierModule } from './modules/supplier/supplier.module';
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
    // A ceiling on how fast one address can call, not a security control.
    // Brute force and e-mail enumeration are Cognito's problem in this design:
    // the app signs in against Cognito directly, so this backend has no login
    // or password-reset route to protect. What it does have is POST
    // /auth/session and the data routes, and this keeps one client from
    // hammering them. See the PR notes.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    SharedAuthModule,
    UsersModule,
    ItemModule,
    SupplierModule,
    AuthModule,
  ],
  controllers: [AppController],
  // The guard is assembled here, and not in SharedAuthModule, because this is
  // the module that can see both halves of it: the verifier and cache from
  // `shared/auth`, and the resolver token from `UsersModule`.
  //
  // Registering it as APP_GUARD is what makes "no use without an account" the
  // default rather than something each controller has to remember. A route is
  // reachable without a token only by saying so with `@Public()`.
  providers: [
    AppService,
    JwtAuthGuard,
    // Order matters: Nest runs APP_GUARDs in the order they are provided, and
    // rate limiting first means a flood is turned away before anything spends
    // time verifying signatures.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
  ],
})
export class AppModule {}
