import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { CronJob } from 'cron';

import { PrismaService } from '../../database/prisma.service.js';
import { RecurringTransactionGenerationService } from './recurring-transaction-generation.service.js';
import {
  DEFAULT_GENERATION_CRON,
  RECURRING_GENERATION_JOB,
} from './recurring-transaction-scheduler.constants.js';
import { RecurringTransactionSchedulerService } from './recurring-transaction-scheduler.service.js';

describe('RecurringTransactionSchedulerService', () => {
  let service: RecurringTransactionSchedulerService;

  const prismaMock = {
    recurringTransaction: {
      findMany: vi.fn(),
    },
  };
  const generationMock = {
    generateDueOccurrences: vi.fn(),
  };
  const configMock = {
    get: vi.fn(),
  };
  const registryMock = {
    addCronJob: vi.fn(),
    deleteCronJob: vi.fn(),
    doesExist: vi.fn(),
  };

  const now = new Date('2026-11-02T09:00:00.000Z');

  function generatedResult() {
    return { status: 'generated', transactions: [{ id: 'txn-1' }] } as const;
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecurringTransactionSchedulerService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: RecurringTransactionGenerationService,
          useValue: generationMock,
        },
        { provide: ConfigService, useValue: configMock },
        { provide: SchedulerRegistry, useValue: registryMock },
      ],
    }).compile();

    service = module.get<RecurringTransactionSchedulerService>(
      RecurringTransactionSchedulerService,
    );

    vi.clearAllMocks();
    // Emulate ConfigService.get fallback semantics unless overridden per test.
    configMock.get.mockImplementation(
      (_key: string, fallback: unknown) => fallback,
    );
  });

  describe('runDueSchedules', () => {
    it('should invoke catch-up generation for due schedules', async () => {
      prismaMock.recurringTransaction.findMany.mockResolvedValue([
        { id: 'r1' },
        { id: 'r2' },
      ]);
      generationMock.generateDueOccurrences.mockResolvedValue([
        generatedResult(),
      ]);

      const summary = await service.runDueSchedules(now);

      expect(
        prismaMock.recurringTransaction.findMany,
      ).toHaveBeenCalledWith({
        where: { isActive: true, nextRunAt: { lte: now } },
        select: { id: true },
      });
      expect(generationMock.generateDueOccurrences).toHaveBeenCalledTimes(2);
      expect(generationMock.generateDueOccurrences).toHaveBeenCalledWith(
        'r1',
        now,
        31,
      );
      expect(generationMock.generateDueOccurrences).toHaveBeenCalledWith(
        'r2',
        now,
        31,
      );
      expect(summary).toEqual({
        generated: 2,
        alreadyGenerated: 0,
        skipped: 0,
        failed: 0,
      });
    });

    it('should pass the configured catch-up limit through', async () => {
      configMock.get.mockImplementation((key: string, fallback: unknown) =>
        key === 'recurring.generationCatchUpLimit' ? 7 : fallback,
      );
      prismaMock.recurringTransaction.findMany.mockResolvedValue([
        { id: 'r1' },
      ]);
      generationMock.generateDueOccurrences.mockResolvedValue([]);

      await service.runDueSchedules(now);

      expect(configMock.get).toHaveBeenCalledWith(
        'recurring.generationCatchUpLimit',
        31,
      );
      expect(generationMock.generateDueOccurrences).toHaveBeenCalledWith(
        'r1',
        now,
        7,
      );
    });

    it('should never see future or inactive schedules', async () => {
      // Future and inactive schedules are excluded by the query itself.
      prismaMock.recurringTransaction.findMany.mockResolvedValue([]);

      const summary = await service.runDueSchedules(now);

      expect(
        prismaMock.recurringTransaction.findMany,
      ).toHaveBeenCalledWith({
        where: { isActive: true, nextRunAt: { lte: now } },
        select: { id: true },
      });
      expect(generationMock.generateDueOccurrences).not.toHaveBeenCalled();
      expect(summary).toEqual({
        generated: 0,
        alreadyGenerated: 0,
        skipped: 0,
        failed: 0,
      });
    });

    it('should aggregate multi-outcome catch-up runs', async () => {
      prismaMock.recurringTransaction.findMany.mockResolvedValue([
        { id: 'r1' },
        { id: 'r2' },
      ]);
      generationMock.generateDueOccurrences
        .mockResolvedValueOnce([
          generatedResult(),
          generatedResult(),
          { status: 'not-due' },
        ])
        .mockResolvedValueOnce([
          {
            status: 'already-generated',
            transactions: [{ id: 'txn-winner' }],
          },
        ]);

      const summary = await service.runDueSchedules(now);

      // already-generated is normal; terminal not-due maps to skipped.
      expect(summary).toEqual({
        generated: 2,
        alreadyGenerated: 1,
        skipped: 1,
        failed: 0,
      });
    });

    it('should skip schedules that became ineligible after enumeration', async () => {
      prismaMock.recurringTransaction.findMany.mockResolvedValue([
        { id: 'r1' },
        { id: 'r2' },
      ]);
      generationMock.generateDueOccurrences
        .mockResolvedValueOnce([{ status: 'not-due' }])
        .mockResolvedValueOnce([{ status: 'inactive' }]);

      const summary = await service.runDueSchedules(now);

      expect(summary).toEqual({
        generated: 0,
        alreadyGenerated: 0,
        skipped: 2,
        failed: 0,
      });
    });

    it('should isolate generation failures without aborting the sweep', async () => {
      prismaMock.recurringTransaction.findMany.mockResolvedValue([
        { id: 'r1' },
        { id: 'r2' },
      ]);
      generationMock.generateDueOccurrences
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce([generatedResult()]);

      const silence = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      const summary = await service.runDueSchedules(now);

      expect(generationMock.generateDueOccurrences).toHaveBeenCalledTimes(2);
      expect(summary).toEqual({
        generated: 1,
        alreadyGenerated: 0,
        skipped: 0,
        failed: 1,
      });
      silence.mockRestore();
    });

    it('should skip an overlapping sweep while one is running', async () => {
      prismaMock.recurringTransaction.findMany.mockResolvedValue([
        { id: 'r1' },
      ]);

      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      generationMock.generateDueOccurrences.mockImplementationOnce(() =>
        gate.then(() => [generatedResult()]),
      );

      const first = service.runDueSchedules(now);
      const overlapped = await service.runDueSchedules(now);

      expect(overlapped).toEqual({
        generated: 0,
        alreadyGenerated: 0,
        skipped: 1,
        failed: 0,
      });

      release();
      const summary = await first;

      expect(summary.generated).toBe(1);
      expect(generationMock.generateDueOccurrences).toHaveBeenCalledTimes(1);
    });
  });

  describe('lifecycle', () => {
    it('should register the configured cron expression in UTC', async () => {
      configMock.get.mockImplementation((key: string, fallback: unknown) =>
        key === 'recurring.generationCron' ? '*/5 * * * *' : fallback,
      );

      service.onModuleInit();

      expect(configMock.get).toHaveBeenCalledWith(
        'recurring.generationCron',
        DEFAULT_GENERATION_CRON,
      );
      expect(registryMock.addCronJob).toHaveBeenCalledTimes(1);

      const [name, job] = registryMock.addCronJob.mock.calls[0] as [
        string,
        CronJob,
      ];
      expect(name).toBe(RECURRING_GENERATION_JOB);
      expect(job).toBeInstanceOf(CronJob);
      expect(job.cronTime.source).toBe('*/5 * * * *');

      await job.stop();
    });

    it('should fall back to the default cron expression', async () => {
      configMock.get.mockImplementation(
        (_key: string, fallback: unknown) => fallback,
      );

      service.onModuleInit();

      const [, job] = registryMock.addCronJob.mock.calls[0] as [
        string,
        CronJob,
      ];
      expect(job.cronTime.source).toBe(DEFAULT_GENERATION_CRON);

      await job.stop();
    });

    it('should remove the job on shutdown', () => {
      registryMock.doesExist.mockReturnValue(true);

      service.onApplicationShutdown();

      expect(registryMock.doesExist).toHaveBeenCalledWith(
        'cron',
        RECURRING_GENERATION_JOB,
      );
      expect(registryMock.deleteCronJob).toHaveBeenCalledWith(
        RECURRING_GENERATION_JOB,
      );
    });

    it('should tolerate shutdown when the job was never registered', () => {
      registryMock.doesExist.mockReturnValue(false);

      service.onApplicationShutdown();

      expect(registryMock.deleteCronJob).not.toHaveBeenCalled();
    });

    it('should log instead of throwing when the sweep itself fails', async () => {
      prismaMock.recurringTransaction.findMany.mockRejectedValue(
        new Error('db down'),
      );
      const silence = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await (
        service as unknown as { onTick(): Promise<void> }
      ).onTick();

      expect(silence).toHaveBeenCalled();
      silence.mockRestore();
    });
  });
});
