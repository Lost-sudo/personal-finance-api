import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [AccountsController],
  providers: [AccountsService, PrismaService],
})
export class AccountsModule {}
