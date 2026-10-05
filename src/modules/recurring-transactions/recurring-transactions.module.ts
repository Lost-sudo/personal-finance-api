import { Module } from '@nestjs/common';
import { RecurringTransactionsController } from './recurring-transactions.controller.js';
import { RecurringTransactionsService } from './recurring-transactions.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [RecurringTransactionsController],
  providers: [RecurringTransactionsService, PrismaService],
})
export class RecurringTransactionsModule {}
