import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

export const GLOBAL_PREFIX = 'api/v1';

// Small DTOs only; 100kb bounds memory/CPU per request.
export const JSON_BODY_LIMIT = '100kb';

export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix(GLOBAL_PREFIX);

  const configService = app.get(ConfigService, { strict: false });

  // Trusted proxy for accurate client IPs (rate limiting).
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.getInstance()?.set?.('trust proxy', 1);

  // Helmet without CSP (JSON API; CSP would break the Swagger UI bundle).
  app.use(helmet({ contentSecurityPolicy: false }));

  // Refresh tokens are transported in httpOnly cookies.
  app.use(cookieParser());

  app.use(json({ limit: JSON_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

  configureCors(app, configService);

  return app;
}

function configureCors(
  app: INestApplication,
  configService: ConfigService,
): void {
  const origins = configService.get<string[]>('cors.origin', []);
  const nodeEnv = configService.get<string>('app.nodeEnvironment', 'development');
  const appEnv = configService.get<string>('app.environment', 'development');
  const isProduction = nodeEnv === 'production' || appEnv === 'production';

  if (origins.length === 0) {
    if (isProduction) {
      throw new Error(
        'CORS_ORIGIN must be set in production (comma-separated allowlist)',
      );
    }

    // No allowlist: leave CORS disabled (never fall back to a wildcard).
    return;
  }

  // Explicit allowlist only — never `origin: '*'` combined with credentials.
  app.enableCors({
    origin: origins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 600,
  });
}
