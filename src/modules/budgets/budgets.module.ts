import { Module } from '@nestjs/common';
import { BudgetsController } from './budgets.controller.js';
import { BudgetsService } from './budgets.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [BudgetsController],
  providers: [BudgetsService, PrismaService],
})
export class BudgetsModule {}
