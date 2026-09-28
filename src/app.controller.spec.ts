import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { PrismaService } from './database/prisma.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((key: string) => {
              const config: Record<string, any> = {
                'app.name': 'Personal Finance API',
                'app.environment': 'development',
                'app.port': 3000,
              };
              return config[key];
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: {},
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return application info', () => {
      expect(appController.getApplicationInfo()).toEqual({
        name: 'Personal Finance API',
        environment: 'development',
        port: 3000,
      });
    });
  });
});
