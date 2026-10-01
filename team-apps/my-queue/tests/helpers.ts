import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAuditLog } from "@acme/audit-log";

import { createApp, type ToolRequest } from "../src/app";
import { ToolAuditLogStore } from "../src/audit-store";
import type { CoreClient, CoreResult, RefundItem } from "../src/core-api";
import { openToolDatabase, type ToolDb } from "../src/db";

export function makeItem(overrides: Partial<RefundItem> = {}): RefundItem {
  return {
    id: "rf_test",
    customerId: "cust_demo_0001",
    amountCents: 500,
    reason: "Duplicate charge",
    status: "pending",
    requestedAt: "2026-09-01T10:00:00.000Z",
    assignedTo: "demo-reviewer",
    reviewedBy: null,
    reviewedAt: null,
    decisionReason: null,
    ageDays: 5,
    overdue: true,
    ...overrides,
  };
}

export type TestContext = {
  db: ToolDb;
  auditLog: ReturnType<typeof createAuditLog>;
  dir: string;
};

/** A real SQLite database in a temp dir — the same code path as the tool's data file. */
export function openTestContext(): TestContext {
  const dir = mkdtempSync(join(tmpdir(), "my-queue-test-"));
  const db = openToolDatabase(join(dir, "tool.db"));
  return { db, auditLog: createAuditLog(new ToolAuditLogStore(db)), dir };
}

/** A core client stub: canned responses plus a record of calls it received. */
export function fakeCore(results: Partial<Record<"listMine" | "approve" | "deny", CoreResult[]>>) {
  const calls: { method: string; id?: string; identity: unknown; payload?: unknown }[] = [];
  const take = (key: "listMine" | "approve" | "deny", fallback: CoreResult): CoreResult => {
    const next = results[key]?.shift();
    return next ?? fallback;
  };
  const core: CoreClient = {
    listMine: (identity) => {
      calls.push({ method: "listMine", identity });
      return Promise.resolve(take("listMine", { status: 200, body: { items: [] } }));
    },
    approve: (identity, id, note) => {
      calls.push({ method: "approve", id, identity, payload: { note } });
      return Promise.resolve(take("approve", { status: 200, body: {} }));
    },
    deny: (identity, id, reason) => {
      calls.push({ method: "deny", id, identity, payload: { reason } });
      return Promise.resolve(take("deny", { status: 200, body: {} }));
    },
  };
  return { core, calls };
}

export function request(partial: Partial<ToolRequest> & { method: string; url: string }): ToolRequest {
  return { headers: {}, ...partial };
}

export const REVIEWER_HEADERS = { "x-mock-role": "reviewer", "x-mock-user-id": "demo-reviewer" };

export { createApp };
