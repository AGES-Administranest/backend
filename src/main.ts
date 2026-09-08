import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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

  // CORS exists for browsers only: the React Native app sends no Origin header
  // and is unaffected either way. What needs it is the Expo web build, which
  // runs on its own localhost port and would otherwise fail every preflight.
  //
  // Production defaults to no CORS at all rather than to a wildcard — for a
  // native-only client that is the correct posture, and the day a web client
  // ships, its origin goes in CORS_ORIGINS deliberately. Credentials stay off:
  // the app authenticates with a Bearer token, never with cookies.
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
      .addTag('auth', 'Local mirror of the Cognito account and terms consent')
      .build();

    SwaggerModule.setup('docs', app, () =>
      SwaggerModule.createDocument(app, swaggerConfig),
    );
  }

  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
