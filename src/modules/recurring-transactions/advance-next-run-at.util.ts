import type { $Enums } from '../../generated/prisma/client.js';

export type RecurringFrequency = $Enums.RecurringFrequency;

// Advances nextRunAt by one frequency step using UTC calendar arithmetic.
// Pure: no clock reads, so fixed-`now` tests stay deterministic.
export function advanceNextRunAt(
  nextRunAt: Date,
  frequency: RecurringFrequency,
): Date {
  const year = nextRunAt.getUTCFullYear();
  const month = nextRunAt.getUTCMonth();
  const day = nextRunAt.getUTCDate();
  const hours = nextRunAt.getUTCHours();
  const minutes = nextRunAt.getUTCMinutes();
  const seconds = nextRunAt.getUTCSeconds();
  const ms = nextRunAt.getUTCMilliseconds();

  switch (frequency) {
    case 'DAILY':
      return new Date(
        Date.UTC(year, month, day + 1, hours, minutes, seconds, ms),
      );
    case 'WEEKLY':
      return new Date(
        Date.UTC(year, month, day + 7, hours, minutes, seconds, ms),
      );
    case 'MONTHLY':
      return addMonthsClamped(
        year,
        month,
        day,
        hours,
        minutes,
        seconds,
        ms,
        1,
      );
    case 'YEARLY':
      return addMonthsClamped(
        year,
        month,
        day,
        hours,
        minutes,
        seconds,
        ms,
        12,
      );
  }
}

// Clamps month-end overflow to the target month's last day (Jan 31 → Feb 28).
function addMonthsClamped(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  seconds: number,
  ms: number,
  monthsToAdd: number,
): Date {
  const targetMonth = month + monthsToAdd;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0));
  const targetDay = Math.min(day, lastDay.getUTCDate());

  return new Date(
    Date.UTC(
      targetYear,
      normalizedMonth,
      targetDay,
      hours,
      minutes,
      seconds,
      ms,
    ),
  );
}
