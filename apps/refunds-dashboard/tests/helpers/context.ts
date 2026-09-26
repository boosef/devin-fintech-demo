import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAuditLog, type AuditLog, type AuditLogStore } from "@acme/audit-log";
import type { MockUser } from "@acme/auth-guard";
import { afterEach } from "vitest";

import { openDatabase, type RefundsDb } from "@/db/client";
import { refundRequests, type RefundStatus } from "@/db/schema";
import { SqliteAuditLogStore } from "@/lib/audit/sqlite-store";
import { encrypt, encryptInteger } from "@/lib/crypto";
import { createRefundService } from "@/lib/refunds/service";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));
export const TEST_KEY = Buffer.alloc(32, 7);

export const reviewer: MockUser = { id: "rev-1", email: "rev-1@example.test", role: "reviewer" };
export const admin: MockUser = { id: "admin-1", email: "admin-1@example.test", role: "admin" };

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

export function tempDbFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "refunds-test-"));
  tempDirs.push(dir);
  return path.join(dir, "refunds.db");
}

export function openTestDb(file = tempDbFile()): RefundsDb {
  return openDatabase(file, { migrationsFolder: MIGRATIONS_FOLDER });
}

export function createContext(options: { store?: (db: RefundsDb) => AuditLogStore } = {}) {
  const db = openTestDb();
  const store = options.store?.(db) ?? new SqliteAuditLogStore(db);
  const auditLog: AuditLog = createAuditLog(store);
  const service = createRefundService({ db, auditLog, encryptionKey: TEST_KEY });
  return { db, store, auditLog, service };
}

export function insertRefund(
  db: RefundsDb,
  overrides: Partial<{ id: string; customerId: string; amountCents: number; status: RefundStatus; requestedAt: string }> = {},
) {
  const row = {
    id: overrides.id ?? crypto.randomUUID(),
    customerId: overrides.customerId ?? "cust_test_0001",
    amountCents: overrides.amountCents ?? 4321,
    status: overrides.status ?? "pending",
    requestedAt: overrides.requestedAt ?? "2026-09-01T10:00:00.000Z",
  };
  db.insert(refundRequests)
    .values({
      id: row.id,
      customerIdEnc: encrypt(row.customerId, TEST_KEY),
      amountCentsEnc: encryptInteger(row.amountCents, TEST_KEY),
      reason: "Duplicate charge",
      status: row.status,
      requestedAt: row.requestedAt,
    })
    .run();
  return row;
}
