import "server-only";

/** A refund request is overdue once it has waited more than this many days. */
export const SLA_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days a request has been waiting, and whether it breached the SLA.
 * `now` is injected so callers/tests control the clock.
 */
export function refundAge(requestedAt: string, now: Date): { ageDays: number; overdue: boolean } {
  const ageDays = Math.floor((now.getTime() - Date.parse(requestedAt)) / DAY_MS);
  return { ageDays, overdue: ageDays > SLA_DAYS };
}
