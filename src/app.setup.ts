import { INestApplication } from '@nestjs/common';

export const GLOBAL_PREFIX = 'api/v1';

export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix(GLOBAL_PREFIX);

  return app;
}
