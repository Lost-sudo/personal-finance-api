import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ConfigService } from '@nestjs/config';
import { configureApp } from './app.setup.js';
import { SwaggerModule } from '@nestjs/swagger';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';
import { createSwaggerConfig } from './config/swagger.config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port', 3000);

  configureApp(app);

  // Swagger outside production only; route schemas aid attackers.
  const swaggerEnabled = configService.get<boolean>('swagger.enabled', false);

  if (swaggerEnabled) {
    const swaggerConfig = createSwaggerConfig();

    const swaggerDocument = SwaggerModule.createDocument(
      app,
      swaggerConfig.build(),
    );

    SwaggerModule.setup('api/docs', app, swaggerDocument);
  }

  app.useGlobalFilters(new GlobalExceptionFilter());

  await app.listen(port);
}
await bootstrap();
