import {
  DEFAULT_GENERATION_CATCH_UP_LIMIT,
  DEFAULT_GENERATION_CRON,
} from '../modules/recurring-transactions/recurring-transaction-scheduler.constants.js';

export default () => ({
  app: {
    name: 'Personal Finance API',
    environment: process.env.APP_ENV ?? 'development',
    nodeEnvironment: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3000),
  },
  database: {
    url: process.env.DATABASE_URL,
  },
  jwt: {
    secret: process.env.JWT_ACCESS_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  cors: {
    // Comma-separated allowlist; empty disables CORS (production requires it).
    origin: (process.env.CORS_ORIGIN ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  },
  throttle: {
    defaultLimit: Number(process.env.THROTTLE_DEFAULT_LIMIT ?? 100),
    defaultTtl: Number(process.env.THROTTLE_DEFAULT_TTL ?? 60000),
    authLimit: Number(process.env.THROTTLE_AUTH_LIMIT ?? 10),
    authTtl: Number(process.env.THROTTLE_AUTH_TTL ?? 60000),
    authStrictLimit: Number(process.env.THROTTLE_AUTH_STRICT_LIMIT ?? 5),
    authStrictTtl: Number(process.env.THROTTLE_AUTH_STRICT_TTL ?? 60000),
  },
  swagger: {
    enabled:
      (process.env.SWAGGER_ENABLED ?? '').toLowerCase() === 'true' ||
      ((process.env.SWAGGER_ENABLED ?? '') === '' &&
        (process.env.NODE_ENV ?? 'development') !== 'production' &&
        (process.env.APP_ENV ?? 'development') !== 'production'),
  },
  recurring: {
    generationCron:
      process.env.RECURRING_GENERATION_CRON ?? DEFAULT_GENERATION_CRON,
    generationCatchUpLimit: Number(
      process.env.RECURRING_GENERATION_CATCH_UP_LIMIT ??
        DEFAULT_GENERATION_CATCH_UP_LIMIT,
    ),
  },
});
