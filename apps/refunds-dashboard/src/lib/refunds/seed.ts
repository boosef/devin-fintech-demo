import "server-only";

import type { MockUser } from "@acme/auth-guard";

import type { RefundsDb } from "@/db/client";
import { refundRequests } from "@/db/schema";
import { encrypt, encryptInteger } from "@/lib/crypto";

import type { RefundService } from "./service";

export const SEED_REQUEST_COUNT = 18;

const DAY_MS = 24 * 60 * 60 * 1000;

const REASONS = [
  "Duplicate charge on statement",
  "Item not received",
  "Subscription cancelled before renewal",
  "Charged the wrong amount",
  "Service outage during billing period",
  "Returned item, refund not processed",
];

/** Synthetic reviewer used only to write the seed decisions through the service. */
const SEED_REVIEWER: MockUser = { id: "seed-reviewer", email: "seed-reviewer@example.test", role: "reviewer" };

/**
 * Assignee names carried over from the legacy tool, mapped onto the two
 * "Viewing as" personas so each one sees its own seeded queue.
 */
const LEGACY_ASSIGNEES: Record<string, string> = {
  "priya.r": "demo-reviewer",
  "sam.k": "demo-admin",
};
const LEGACY_ASSIGNEE_NAMES = Object.keys(LEGACY_ASSIGNEES);

export type SeededRequest = { id: string; customerId: string; amountCents: number };

/**
 * Inserts synthetic, obviously fake refund requests spread across the last 30
 * days, then approves/denies a few through the service so each decision has a
 * matching audit record.
 */
export async function seedRefunds({
  db,
  service,
  encryptionKey,
  now = new Date(),
}: {
  db: RefundsDb;
  service: RefundService;
  encryptionKey: Buffer;
  now?: Date;
}): Promise<SeededRequest[]> {
  const seeded: SeededRequest[] = [];
  for (let i = 0; i < SEED_REQUEST_COUNT; i++) {
    const n = i + 1;
    const request: SeededRequest = {
      id: crypto.randomUUID(),
      customerId: `cust_demo_${String(n).padStart(4, "0")}`,
      amountCents: 1000 + n * 250,
    };
    const requestedAt = new Date(now.getTime() - Math.round(((i * 29) / (SEED_REQUEST_COUNT - 1)) * DAY_MS) - n * 60_000);
    const legacyAssignee = LEGACY_ASSIGNEE_NAMES[i % LEGACY_ASSIGNEE_NAMES.length]!;
    db.insert(refundRequests)
      .values({
        id: request.id,
        customerIdEnc: encrypt(request.customerId, encryptionKey),
        amountCentsEnc: encryptInteger(request.amountCents, encryptionKey),
        reason: REASONS[i % REASONS.length] ?? "Other",
        status: "pending",
        requestedAt: requestedAt.toISOString(),
        assignedTo: LEGACY_ASSIGNEES[legacyAssignee] ?? null,
      })
      .run();
    seeded.push(request);
  }

  // Oldest few already reviewed: 3 approved, 2 denied.
  const [a1, a2, a3, d1, d2] = seeded.slice(-5);
  for (const r of [a1, a2, a3]) {
    if (r) await service.approveRefund({ user: SEED_REVIEWER, id: r.id, note: "Verified against order history (seed data)." });
  }
  if (d1) await service.denyRefund({ user: SEED_REVIEWER, id: d1.id, reason: "Refund window has expired (seed data)." });
  if (d2) await service.denyRefund({ user: SEED_REVIEWER, id: d2.id, reason: "Charge already refunded (seed data)." });

  return seeded;
}
