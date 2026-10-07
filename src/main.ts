import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';
import { JSON_BODY_LIMIT } from './shared/validation/json-body-limit';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Nenhuma resposta de erro é montada fora daqui (ADR-07).
  app.useGlobalFilters(new AllExceptionsFilter());

  const config = app.get(ConfigService);
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  // Behind App Runner every request arrives from its proxy, so without this
  // `req.ip` is the proxy's address and the throttler puts every user in one
  // bucket. A hop count, not `true`: only the entries the proxies appended to
  // X-Forwarded-For are trusted, never what the client sent.
  const trustProxyHops = Number(config.get<string>('TRUST_PROXY_HOPS') ?? 0);
  if (trustProxyHops > 0) {
    app.set('trust proxy', trustProxyHops);
  }

  const corsOrigins = (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  if (corsOrigins.length > 0) {
    app.enableCors({ origin: corsOrigins });
  } else if (!isProduction) {
    app.enableCors();
  }

  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('AGES Backend')
      .setDescription('Documentação da API do projeto AGES')
      .setVersion('1.0')
      .addTag('users', 'Gerenciamento de usuários')
      .addTag(
        'stock-movement',
        'Stock ledger: history, manual adjustments, purchases and counts',
      )
      .addTag('item', 'Estoque de insumos e medicamentos')
      .addTag('supplier', 'Fornecedores do usuário')
      .addTag('client', 'Clínicas e hospitais atendidos pelo usuário')
      .addTag('appointments', 'Agendamentos do usuário')
      .addTag('auth', 'Local mirror of the Cognito account and terms consent')
      // Without this the page is unusable now that the guard is global: every
      // request from /docs would answer 401 with nowhere to put a token.
      // `npm run dev:token` prints one to paste into Authorize.
      .addBearerAuth({
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Cognito IdToken — npm run dev:token',
      })
      .build();

    SwaggerModule.setup('docs', app, () =>
      SwaggerModule.createDocument(app, swaggerConfig),
    );
  }

  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
