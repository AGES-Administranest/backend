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
