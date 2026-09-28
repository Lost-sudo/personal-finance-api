import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ConfigService } from '@nestjs/config';
import { configureApp } from './app.setup.js';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port', 3000);

  configureApp(app);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Personal Finance & Expense Management API')
    .setDescription(
      'REST API for managing personal finance, expenses, categories, accounts, budgets, recurring financial records, and financial reports.',
    )
    .setVersion('1.0')
    .addTag('Categories', 'Income and expense category management')
    .build();

  const documentFactory = () =>
    SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup('docs', app, documentFactory);

  app.useGlobalFilters(new GlobalExceptionFilter());

  await app.listen(port);
}
await bootstrap();
