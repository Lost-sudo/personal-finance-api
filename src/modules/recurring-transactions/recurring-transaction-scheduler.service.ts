import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PrismaService } from '../../database/prisma.service.js';
import { RecurringTransactionGenerationService } from './recurring-transaction-generation.service.js';
import {
  DEFAULT_GENERATION_CATCH_UP_LIMIT,
  DEFAULT_GENERATION_CRON,
  RECURRING_GENERATION_JOB,
} from './recurring-transaction-scheduler.constants.js';

export interface GenerationSweepSummary {
  generated: number;
  alreadyGenerated: number;
  skipped: number;
  failed: number;
}

// Owns timing only: enumerate due schedules, delegate to the generation
// service. Overlaps skip in-process; cross-worker races resolve via the
// uniqueness guard as 'already-generated'.
@Injectable()
export class RecurringTransactionSchedulerService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(
    RecurringTransactionSchedulerService.name,
  );
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly generation: RecurringTransactionGenerationService,
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const cronExpression = this.config.get<string>(
      'recurring.generationCron',
      DEFAULT_GENERATION_CRON,
    );

    // UTC cadence (server-locale independent). Invalid expressions fail fast
    // at startup; first sweep waits for first fire.
    const job = new CronJob(
      cronExpression,
      () => void this.onTick(),
      null,
      false,
      'UTC',
    );
    this.schedulerRegistry.addCronJob(RECURRING_GENERATION_JOB, job);
    job.start();
  }

  onApplicationShutdown(): void {
    if (this.schedulerRegistry.doesExist('cron', RECURRING_GENERATION_JOB)) {
      this.schedulerRegistry.deleteCronJob(RECURRING_GENERATION_JOB);
    }
  }

  // Last-resort guard: per-schedule failures are contained below; never leak
  // an unhandled rejection.
  private async onTick(): Promise<void> {
    try {
      await this.runDueSchedules();
    } catch (error) {
      this.logger.error(
        'Recurring generation sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async runDueSchedules(now: Date = new Date()): Promise<GenerationSweepSummary> {
    if (this.isRunning) {
      this.logger.debug('Skipping overlapping generation sweep');
      return { generated: 0, alreadyGenerated: 0, skipped: 1, failed: 0 };
    }

    this.isRunning = true;

    try {
      const due = await this.prisma.recurringTransaction.findMany({
        where: { isActive: true, nextRunAt: { lte: now } },
        select: { id: true },
      });
      const catchUpLimit = this.config.get<number>(
        'recurring.generationCatchUpLimit',
        DEFAULT_GENERATION_CATCH_UP_LIMIT,
      );

      const summary: GenerationSweepSummary = {
        generated: 0,
        alreadyGenerated: 0,
        skipped: 0,
        failed: 0,
      };

      this.logger.debug(
        `Generation sweep started for ${due.length} due schedule(s)`,
      );

      // Drain each backlog up to the limit; remainder stays due for later sweeps.
      for (const schedule of due) {
        try {
          const outcomes = await this.generation.generateDueOccurrences(
            schedule.id,
            now,
            catchUpLimit,
          );

          for (const outcome of outcomes) {
            switch (outcome.status) {
              case 'generated':
                summary.generated += 1;
                break;
              case 'already-generated':
                summary.alreadyGenerated += 1;
                break;
              case 'not-due':
              case 'inactive':
                // Caught up or lost a race with an edit/worker. Benign: skip.
                summary.skipped += 1;
                break;
            }
          }
        } catch (error) {
          summary.failed += 1;
          this.logger.error(
            `Failed to generate occurrences for schedule ${schedule.id}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }

      // Counts only, no financial values. Debug when quiet to avoid per-minute spam.
      const loud =
        summary.generated > 0 ||
        summary.alreadyGenerated > 0 ||
        summary.failed > 0;
      const line =
        `Generation sweep complete: ${summary.generated} generated, ` +
        `${summary.alreadyGenerated} already generated, ` +
        `${summary.skipped} skipped, ${summary.failed} failed`;
      if (loud) {
        this.logger.log(line);
      } else {
        this.logger.debug(line);
      }

      return summary;
    } finally {
      this.isRunning = false;
    }
  }
}
