import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './database/prisma.service.js';


@Controller()
export class AppController {
  constructor(private readonly configService: ConfigService, private readonly prisma: PrismaService) {}

  @Get()
  getApplicationInfo() {
    return {
      name: this.configService.get<string>('app.name'),
      environment: this.configService.get<string>('app.environment'),
      port: this.configService.get<number>('app.port'),
    }
  }
}
