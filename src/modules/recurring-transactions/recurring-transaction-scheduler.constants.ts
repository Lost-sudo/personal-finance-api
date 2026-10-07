// Import-safe shared constants (no imports, no cycles).

// SchedulerRegistry key. Internal identifier — keep as code, not env.
export const RECURRING_GENERATION_JOB = 'recurring-transaction-generation';

// Default sweep cadence when RECURRING_GENERATION_CRON is unset.
export const DEFAULT_GENERATION_CRON = '*/1 * * * *';

// Default per-sweep catch-up cap when RECURRING_GENERATION_CATCH_UP_LIMIT is unset.
export const DEFAULT_GENERATION_CATCH_UP_LIMIT = 31;
