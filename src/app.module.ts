import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './infra/prisma/prisma.module';
import { UsersModule } from './modules/users/users.module';

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
    UsersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
