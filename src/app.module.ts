import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration.js';
import Joi from 'joi';
import {
  DEFAULT_GENERATION_CATCH_UP_LIMIT,
  DEFAULT_GENERATION_CRON,
} from './modules/recurring-transactions/recurring-transaction-scheduler.constants.js';
import { DatabaseModule } from './database/database.module.js';
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
        JWT_ACCESS_SECRET: Joi.string().min(32).required(),
        JWT_EXPIRES_IN: Joi.string().default('15m'),
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
  providers: [AppService],
})
export class AppModule {}
