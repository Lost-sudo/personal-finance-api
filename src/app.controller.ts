import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';


@Controller()
export class AppController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  getApplicationInfo() {
    return {
      name: this.configService.get<string>('app.name'),
      environment: this.configService.get<string>('app.environment'),
      port: this.configService.get<number>('app.port'),
    }
  }
}
