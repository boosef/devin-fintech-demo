import { describe, expect, it } from "vitest";

import { formatCents } from "../src/render";
import { orderQueue, summarizeQueue } from "../src/queue";

import { makeItem } from "./helpers";

describe("queue ordering (bug #1 regression)", () => {
  it("orders oldest-first by the real timestamp across at least two months", () => {
    const items = [
      makeItem({ id: "rf_sep_early", requestedAt: "2026-09-02T09:00:00.000Z" }),
      makeItem({ id: "rf_aug_late", requestedAt: "2026-08-28T09:00:00.000Z" }),
      makeItem({ id: "rf_sep_late", requestedAt: "2026-09-24T09:00:00.000Z" }),
    ];

    const ordered = orderQueue(items);

    // A dd/mm/yyyy lexicographic compare would put 02/09/2026 before
    // 28/08/2026 ("02" < "28"), showing a September row ahead of the older
    // August one. The real timestamps give the right order.
    expect(ordered.map((i) => i.id)).toEqual(["rf_aug_late", "rf_sep_early", "rf_sep_late"]);
  });
});

describe("queue summary (bug #2 regression)", () => {
  it("counts the full value of an amount >= $1,000 from the numeric field", () => {
    const summary = summarizeQueue([
      makeItem({ amountCents: 125_000 }), // "$1,250.00" — parseFloat of that string yields 1.25
      makeItem({ amountCents: 8_999 }),
    ]);

    expect(summary.totalCents).toBe(133_999);
    expect(formatCents(summary.totalCents)).toBe("$1,339.99");
  });

  it("counts open items and API-computed overdue flags", () => {
    const summary = summarizeQueue([makeItem({ overdue: true }), makeItem({ overdue: false })]);

    expect(summary).toMatchObject({ openCount: 2, overdueCount: 1 });
  });
});
