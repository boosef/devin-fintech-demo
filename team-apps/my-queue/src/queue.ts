import type { RefundItem } from "./core-api";

/**
 * FIFO order by the real requested-at timestamp. Regression guard for the
 * legacy bug: the old tool sorted the dd/mm/yyyy string lexicographically,
 * which put earlier days of a later month ahead of older rows.
 */
export function orderQueue(items: RefundItem[]): RefundItem[] {
  return [...items].sort((a, b) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt));
}

export type QueueSummary = {
  openCount: number;
  /** count of items the core API marked overdue (ageDays > SLA_DAYS) */
  overdueCount: number;
  /** sum of the API's numeric amountCents — never parsed from a display string */
  totalCents: number;
};

export function summarizeQueue(items: RefundItem[]): QueueSummary {
  return {
    openCount: items.length,
    overdueCount: items.filter((item) => item.overdue).length,
    totalCents: items.reduce((total, item) => total + item.amountCents, 0),
  };
}
