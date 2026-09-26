import "server-only";

import { createAuditLog, type AuditLog, type AuditRecord } from "@acme/audit-log";
import { hasRole, type MockUser, type Role } from "@acme/auth-guard";
import { and, desc, eq, gte, lt, type SQL } from "drizzle-orm";

import { defaultDatabasePath, openDatabase, type RefundsDb } from "@/db/client";
import { refundRequests, REFUND_STATUSES, type RefundRequestRow, type RefundStatus } from "@/db/schema";
import { SqliteAuditLogStore } from "@/lib/audit/sqlite-store";
import { decrypt, decryptInteger, loadEncryptionKey } from "@/lib/crypto";

import { RefundServiceError } from "./errors";

export const REVIEWER_ROLES: Role[] = ["reviewer", "admin"];
export const REFUND_ENTITY_TYPE = "refund_request";
export const MAX_DECISION_REASON_LENGTH = 1000;

export type RefundRequest = {
  id: string;
  customerId: string;
  amountCents: number;
  reason: string;
  status: RefundStatus;
  requestedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  decisionReason: string | null;
};

export type RefundFilter = {
  /** defaults to "pending" */
  status?: RefundStatus | "all";
  /** inclusive, YYYY-MM-DD (UTC) */
  from?: string;
  /** inclusive, YYYY-MM-DD (UTC) */
  to?: string;
};

export type ApproveInput = { user: MockUser | null; id: string; note?: string };
export type DenyInput = { user: MockUser | null; id: string; reason: string };

export type RefundServiceDeps = {
  db: RefundsDb;
  auditLog: AuditLog;
  encryptionKey: Buffer;
  now?: () => Date;
};

export type RefundService = ReturnType<typeof createRefundService>;

type ReviewFields = Pick<RefundRequestRow, "status" | "reviewedBy" | "reviewedAt" | "decisionReason">;

export function canReview(user: MockUser | null): user is MockUser {
  return hasRole(user, REVIEWER_ROLES);
}

export function createRefundService({ db, auditLog, encryptionKey, now = () => new Date() }: RefundServiceDeps) {
  function requireReviewer(user: MockUser | null): MockUser {
    if (!canReview(user)) {
      throw new RefundServiceError("forbidden", "Only a reviewer or admin can do this.");
    }
    return user;
  }

  function toRefundRequest(row: RefundRequestRow): RefundRequest {
    return {
      id: row.id,
      customerId: decrypt(row.customerIdEnc, encryptionKey),
      amountCents: decryptInteger(row.amountCentsEnc, encryptionKey),
      reason: row.reason,
      status: row.status,
      requestedAt: row.requestedAt,
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt,
      decisionReason: row.decisionReason,
    };
  }

  function findRow(id: string): RefundRequestRow | undefined {
    return db.select().from(refundRequests).where(eq(refundRequests.id, id)).get();
  }

  async function decide(
    user: MockUser,
    id: string,
    status: Exclude<RefundStatus, "pending">,
    decisionReason: string | null,
  ): Promise<RefundRequest> {
    const current = findRow(id);
    if (current === undefined) {
      throw new RefundServiceError("not_found", `Refund request ${id} does not exist.`);
    }

    const before: ReviewFields = {
      status: "pending",
      reviewedBy: current.reviewedBy,
      reviewedAt: current.reviewedAt,
      decisionReason: current.decisionReason,
    };
    const after: ReviewFields = {
      status,
      reviewedBy: user.id,
      reviewedAt: now().toISOString(),
      decisionReason,
    };

    // Conditional update: only one reviewer can move a request out of pending.
    const result = db
      .update(refundRequests)
      .set(after)
      .where(and(eq(refundRequests.id, id), eq(refundRequests.status, "pending")))
      .run();
    if (result.changes === 0) {
      throw new RefundServiceError("conflict", `Refund request ${id} has already been reviewed.`);
    }

    try {
      await auditLog.recordAuditEvent({
        actor: user.id,
        actorType: "human",
        action: status === "approved" ? "refund.approved" : "refund.denied",
        entityType: REFUND_ENTITY_TYPE,
        entityId: id,
        before: toAuditState(before),
        after: toAuditState(after),
      });
    } catch (error) {
      // Compensate so the status change and its audit record succeed or fail together.
      db.update(refundRequests)
        .set(before)
        .where(
          and(
            eq(refundRequests.id, id),
            eq(refundRequests.status, status),
            eq(refundRequests.reviewedBy, user.id),
          ),
        )
        .run();
      throw new RefundServiceError("audit_failed", "Could not write the audit record; the request is still pending.", {
        cause: error,
      });
    }

    const updated = findRow(id);
    if (updated === undefined) {
      throw new RefundServiceError("not_found", `Refund request ${id} does not exist.`);
    }
    return toRefundRequest(updated);
  }

  return {
    async listRefunds({ user, filter = {} }: { user: MockUser | null; filter?: RefundFilter }): Promise<RefundRequest[]> {
      requireReviewer(user);
      const status = filter.status ?? "pending";
      if (status !== "all" && !REFUND_STATUSES.includes(status)) {
        throw new RefundServiceError("validation", `Unknown status "${String(status)}".`);
      }

      const conditions: SQL[] = [];
      if (status !== "all") conditions.push(eq(refundRequests.status, status));
      if (filter.from) conditions.push(gte(refundRequests.requestedAt, startOfUtcDay(filter.from, "from")));
      if (filter.to) conditions.push(lt(refundRequests.requestedAt, startOfNextUtcDay(filter.to, "to")));

      const rows = db
        .select()
        .from(refundRequests)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(refundRequests.requestedAt))
        .all();
      return rows.map(toRefundRequest);
    },

    async approveRefund({ user, id, note }: ApproveInput): Promise<RefundRequest> {
      const reviewer = requireReviewer(user);
      const trimmed = note?.trim() ?? "";
      assertReasonLength(trimmed);
      return decide(reviewer, id, "approved", trimmed === "" ? null : trimmed);
    },

    async denyRefund({ user, id, reason }: DenyInput): Promise<RefundRequest> {
      const reviewer = requireReviewer(user);
      const trimmed = reason.trim();
      if (trimmed === "") {
        throw new RefundServiceError("validation", "A reason is required to deny a refund.");
      }
      assertReasonLength(trimmed);
      return decide(reviewer, id, "denied", trimmed);
    },

    async listAuditTrail({ user, refundId }: { user: MockUser | null; refundId?: string }): Promise<AuditRecord[]> {
      requireReviewer(user);
      const records = await auditLog.queryAuditLog({
        entityType: REFUND_ENTITY_TYPE,
        ...(refundId ? { entityId: refundId } : {}),
      });
      return [...records].reverse();
    },
  };
}

/** Only review fields go into the audit log: never the customer id or amount. */
function toAuditState(fields: ReviewFields) {
  return {
    status: fields.status,
    reviewed_by: fields.reviewedBy,
    reviewed_at: fields.reviewedAt,
    decision_reason: fields.decisionReason,
  };
}

function assertReasonLength(reason: string): void {
  if (reason.length > MAX_DECISION_REASON_LENGTH) {
    throw new RefundServiceError("validation", `Reason must be at most ${MAX_DECISION_REASON_LENGTH} characters.`);
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnly(value: string, field: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!DATE_ONLY.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new RefundServiceError("validation", `"${field}" must be a date in YYYY-MM-DD format.`);
  }
  return date;
}

function startOfUtcDay(value: string, field: string): string {
  return parseDateOnly(value, field).toISOString();
}

function startOfNextUtcDay(value: string, field: string): string {
  const date = parseDateOnly(value, field);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

// Process-wide default instance for the Next.js app, cached on globalThis so
// dev-mode hot reloads don't open a new SQLite connection each time.
const globalForRefunds = globalThis as typeof globalThis & { __refundService?: RefundService };

export function getRefundService(): RefundService {
  if (globalForRefunds.__refundService === undefined) {
    const db = openDatabase(defaultDatabasePath());
    globalForRefunds.__refundService = createRefundService({
      db,
      auditLog: createAuditLog(new SqliteAuditLogStore(db)),
      encryptionKey: loadEncryptionKey(),
    });
  }
  return globalForRefunds.__refundService;
}

export const listRefunds: RefundService["listRefunds"] = (input) => getRefundService().listRefunds(input);
export const approveRefund: RefundService["approveRefund"] = (input) => getRefundService().approveRefund(input);
export const denyRefund: RefundService["denyRefund"] = (input) => getRefundService().denyRefund(input);
export const listAuditTrail: RefundService["listAuditTrail"] = (input) => getRefundService().listAuditTrail(input);
