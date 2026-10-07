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
