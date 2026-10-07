import { Module, type ExecutionContext } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration.js';
import Joi from 'joi';
import {
  DEFAULT_GENERATION_CATCH_UP_LIMIT,
  DEFAULT_GENERATION_CRON,
} from './modules/recurring-transactions/recurring-transaction-scheduler.constants.js';
import { DatabaseModule } from './database/database.module.js';
import { GLOBAL_PREFIX } from './app.setup.js';
import { CategoriesModule } from './modules/categories/categories.module.js';
import { AccountsModule } from './modules/accounts/accounts.module.js';
import { TransactionsModule } from './modules/transactions/transactions.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { RecurringTransactionsModule } from './modules/recurring-transactions/recurring-transactions.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { AuthModule } from './modules/auth/auth.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],

      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'test', 'staging', 'production')
          .default('development'),
        APP_ENV: Joi.string()
          .valid('development', 'test', 'staging', 'production')
          .default('development'),
        PORT: Joi.number().port().default(3000),
        DATABASE_URL: Joi.string()
          .uri({ scheme: ['postgresql', 'postgres'] })
          .required(),
        JWT_ACCESS_SECRET: Joi.string()
          .min(32)
          .when('NODE_ENV', { is: 'test', otherwise: Joi.required() }),
        JWT_REFRESH_SECRET: Joi.string()
          .min(32)
          .when('NODE_ENV', { is: 'test', otherwise: Joi.required() })
          .invalid(Joi.ref('JWT_ACCESS_SECRET'))
          .messages({
            'any.invalid':
              'JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET',
          }),
        JWT_EXPIRES_IN: Joi.string()
          .pattern(/^\d+[smhd]$/, 'e.g. 15m, 1h, 7d')
          .default('15m'),
        JWT_REFRESH_EXPIRES_IN: Joi.string()
          .pattern(/^\d+[smhd]$/, 'e.g. 15m, 1h, 7d')
          .default('7d'),
        CORS_ORIGIN: Joi.string()
          .allow('')
          .optional()
          .custom((value: string, helpers: Joi.CustomHelpers) => {
            if (value === '') {
              return value;
            }

            const origins = value
              .split(',')
              .map((origin) => origin.trim())
              .filter(Boolean);
            const allHttp = origins.length > 0 && origins.every((origin) =>
              /^https?:\/\/[^/\s]+(:\d+)?(\/\S*)?$/.test(origin),
            );

            if (!allHttp) {
              return helpers.error('string.uriList');
            }

            return value;
          })
          .messages({
            'string.uriList':
              'CORS_ORIGIN must be empty or a comma-separated list of http(s) URLs',
          }),
        SWAGGER_ENABLED: Joi.string().valid('true', 'false', '').optional(),
        THROTTLE_DEFAULT_LIMIT: Joi.number()
          .integer()
          .min(1)
          .default(100),
        THROTTLE_DEFAULT_TTL: Joi.number().integer().min(1000).default(60000),
        THROTTLE_AUTH_LIMIT: Joi.number().integer().min(1).default(10),
        THROTTLE_AUTH_TTL: Joi.number().integer().min(1000).default(60000),
        THROTTLE_AUTH_STRICT_LIMIT: Joi.number().integer().min(1).default(5),
        THROTTLE_AUTH_STRICT_TTL: Joi.number()
          .integer()
          .min(1000)
          .default(60000),
        // Five-field cron expression; validated for shape here and parsed
        // strictly by the CronJob constructor at startup (fail-fast).
        RECURRING_GENERATION_CRON: Joi.string()
          .pattern(
            /^(\S+ ){4}\S+$/,
            'must be a five-field cron expression',
          )
          .default(DEFAULT_GENERATION_CRON),
        RECURRING_GENERATION_CATCH_UP_LIMIT: Joi.number()
          .integer()
          .min(1)
          .default(DEFAULT_GENERATION_CATCH_UP_LIMIT),
      }),
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // Both auth budgets apply to authentication routes only. Login and
        // register feel each (strict wins); refresh/logout skip the strict
        // one via @SkipThrottle.
        const skipNonAuthPaths = (context: ExecutionContext): boolean => {
          const request = context
            .switchToHttp()
            .getRequest<{ url?: string }>();
          const path = (request.url ?? '').split('?')[0];

          return !path.startsWith(`/${GLOBAL_PREFIX}/auth`);
        };

        return {
          throttlers: [
            {
              name: 'default',
              limit: configService.get<number>('throttle.defaultLimit', 100),
              ttl: configService.get<number>('throttle.defaultTtl', 60000),
            },
            {
              name: 'auth',
              limit: configService.get<number>('throttle.authLimit', 10),
              ttl: configService.get<number>('throttle.authTtl', 60000),
              skipIf: skipNonAuthPaths,
            },
            {
              name: 'authStrict',
              limit: configService.get<number>(
                'throttle.authStrictLimit',
                5,
              ),
              ttl: configService.get<number>(
                'throttle.authStrictTtl',
                60000,
              ),
              skipIf: skipNonAuthPaths,
            },
          ],
        };
      },
    }),
    DatabaseModule,
    CategoriesModule,
    AccountsModule,
    TransactionsModule,
    ReportsModule,
    RecurringTransactionsModule,
    UsersModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global rate limiting; auth routes use the stricter `auth` budget.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
