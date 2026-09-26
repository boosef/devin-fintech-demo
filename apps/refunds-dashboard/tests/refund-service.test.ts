import type { AuditLogStore } from "@acme/audit-log";
import type { MockUser } from "@acme/auth-guard";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { refundRequests } from "@/db/schema";
import { SqliteAuditLogStore } from "@/lib/audit/sqlite-store";
import { RefundServiceError } from "@/lib/refunds/errors";

import { admin, createContext, insertRefund, reviewer } from "./helpers/context";

async function expectRefundError(promise: Promise<unknown>, code: RefundServiceError["code"]) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(RefundServiceError);
  expect((error as RefundServiceError).code).toBe(code);
}

function rawRow(ctx: ReturnType<typeof createContext>, id: string) {
  return ctx.db.select().from(refundRequests).where(eq(refundRequests.id, id)).get();
}

describe("approveRefund", () => {
  it("approves a pending request and writes one audit record", async () => {
    const ctx = createContext();
    const { id } = insertRefund(ctx.db);

    const result = await ctx.service.approveRefund({ user: reviewer, id, note: "  looks fine  " });

    expect(result.status).toBe("approved");
    expect(result.reviewedBy).toBe(reviewer.id);
    expect(result.reviewedAt).not.toBeNull();
    expect(result.decisionReason).toBe("looks fine");

    const records = await ctx.auditLog.queryAuditLog({ entityId: id });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      actor: reviewer.id,
      actorType: "human",
      action: "refund.approved",
      entityType: "refund_request",
      entityId: id,
      before: { status: "pending", reviewed_by: null, reviewed_at: null, decision_reason: null },
      after: { status: "approved", reviewed_by: reviewer.id, reviewed_at: result.reviewedAt, decision_reason: "looks fine" },
    });
  });
});

describe("denyRefund", () => {
  it("denies with a reason, stores decision_reason and writes one audit record", async () => {
    const ctx = createContext();
    const { id } = insertRefund(ctx.db);

    const result = await ctx.service.denyRefund({ user: admin, id, reason: "Outside refund window" });

    expect(result.status).toBe("denied");
    expect(result.reviewedBy).toBe(admin.id);
    expect(result.reviewedAt).not.toBeNull();
    expect(rawRow(ctx, id)?.decisionReason).toBe("Outside refund window");

    const records = await ctx.auditLog.queryAuditLog({ entityId: id });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      actor: admin.id,
      actorType: "human",
      action: "refund.denied",
      entityType: "refund_request",
      entityId: id,
      after: { status: "denied", reviewed_by: admin.id, decision_reason: "Outside refund window" },
    });
  });

  it.each(["", "   \n\t "])("rejects a deny with reason %j and changes nothing", async (reason) => {
    const ctx = createContext();
    const { id } = insertRefund(ctx.db);
    const before = rawRow(ctx, id);

    await expectRefundError(ctx.service.denyRefund({ user: reviewer, id, reason }), "validation");

    expect(rawRow(ctx, id)).toEqual(before);
    expect(await ctx.auditLog.queryAuditLog({ entityId: id })).toEqual([]);
  });
});

describe("authorization", () => {
  const noRoleUser = { id: "someone", email: "someone@example.test", role: "viewer" } as unknown as MockUser;

  it.each([
    ["a null user", null],
    ["a user without a reviewer/admin role", noRoleUser],
  ])("rejects approve and deny for %s and changes nothing", async (_label, user) => {
    const ctx = createContext();
    const { id } = insertRefund(ctx.db);
    const before = rawRow(ctx, id);

    await expectRefundError(ctx.service.approveRefund({ user, id }), "forbidden");
    await expectRefundError(ctx.service.denyRefund({ user, id, reason: "no" }), "forbidden");
    await expectRefundError(ctx.service.listRefunds({ user }), "forbidden");

    expect(rawRow(ctx, id)).toEqual(before);
    expect(await ctx.auditLog.queryAuditLog({ entityId: id })).toEqual([]);
  });
});

describe("single transition out of pending", () => {
  it("returns a conflict for an already-reviewed request and writes no second audit record", async () => {
    const ctx = createContext();
    const { id } = insertRefund(ctx.db);
    await ctx.service.approveRefund({ user: reviewer, id });
    const afterFirst = rawRow(ctx, id);

    await expectRefundError(ctx.service.approveRefund({ user: admin, id }), "conflict");
    await expectRefundError(ctx.service.denyRefund({ user: admin, id, reason: "late" }), "conflict");

    expect(rawRow(ctx, id)).toEqual(afterFirst);
    expect(await ctx.auditLog.queryAuditLog({ entityId: id })).toHaveLength(1);
  });

  it("maps a conflict to HTTP 409 and an unknown id to 404", async () => {
    const ctx = createContext();
    const { id } = insertRefund(ctx.db, { status: "denied" });

    const conflict = await ctx.service.approveRefund({ user: reviewer, id }).catch((e: unknown) => e);
    expect((conflict as RefundServiceError).httpStatus).toBe(409);
    const missing = await ctx.service.approveRefund({ user: reviewer, id: "nope" }).catch((e: unknown) => e);
    expect((missing as RefundServiceError).httpStatus).toBe(404);
  });
});

describe("audit records", () => {
  it("never contain the customer id or amount", async () => {
    const ctx = createContext();
    const a = insertRefund(ctx.db, { customerId: "cust_secret_7777", amountCents: 987654 });
    const d = insertRefund(ctx.db, { customerId: "cust_secret_8888", amountCents: 123789 });
    await ctx.service.approveRefund({ user: reviewer, id: a.id, note: "ok" });
    await ctx.service.denyRefund({ user: reviewer, id: d.id, reason: "not eligible" });

    const serialized = JSON.stringify(await ctx.auditLog.queryAuditLog({}));
    for (const value of ["cust_secret_7777", "cust_secret_8888", "987654", "123789", "customer", "amount"]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("keeps the request pending when the audit append throws", async () => {
    const ctx = createContext({
      store: (db): AuditLogStore => {
        const real = new SqliteAuditLogStore(db);
        return {
          append: async () => {
            throw new Error("audit store unavailable");
          },
          query: (filter) => real.query(filter),
        };
      },
    });
    const { id } = insertRefund(ctx.db);
    const before = rawRow(ctx, id);

    await expectRefundError(ctx.service.approveRefund({ user: reviewer, id }), "audit_failed");
    await expectRefundError(ctx.service.denyRefund({ user: reviewer, id, reason: "x" }), "audit_failed");

    expect(rawRow(ctx, id)).toEqual(before);
    expect(rawRow(ctx, id)?.status).toBe("pending");
  });
});

describe("listRefunds filters", () => {
  it("filters by status (default pending) and inclusive requested_at date range", async () => {
    const ctx = createContext();
    const early = insertRefund(ctx.db, { requestedAt: "2026-09-01T08:00:00.000Z" });
    const mid = insertRefund(ctx.db, { requestedAt: "2026-09-10T23:59:59.000Z" });
    const late = insertRefund(ctx.db, { requestedAt: "2026-09-20T00:00:00.000Z" });
    const approved = insertRefund(ctx.db, { status: "approved", requestedAt: "2026-09-10T12:00:00.000Z" });
    const denied = insertRefund(ctx.db, { status: "denied", requestedAt: "2026-09-02T12:00:00.000Z" });

    const ids = (list: { id: string }[]) => list.map((r) => r.id).sort();

    expect(ids(await ctx.service.listRefunds({ user: reviewer }))).toEqual([early.id, mid.id, late.id].sort());
    expect(ids(await ctx.service.listRefunds({ user: reviewer, filter: { status: "approved" } }))).toEqual([approved.id]);
    expect(ids(await ctx.service.listRefunds({ user: reviewer, filter: { status: "denied" } }))).toEqual([denied.id]);
    expect(
      ids(await ctx.service.listRefunds({ user: reviewer, filter: { status: "pending", from: "2026-09-02", to: "2026-09-10" } })),
    ).toEqual([mid.id]);
    expect(
      ids(await ctx.service.listRefunds({ user: reviewer, filter: { status: "all", from: "2026-09-10", to: "2026-09-20" } })),
    ).toEqual([mid.id, late.id, approved.id].sort());
    expect(
      ids(await ctx.service.listRefunds({ user: reviewer, filter: { status: "all", from: "2026-09-01", to: "9999-12-31" } })),
    ).toHaveLength(5);

    const [first] = await ctx.service.listRefunds({ user: reviewer, filter: { from: "2026-09-01", to: "2026-09-01" } });
    expect(first).toMatchObject({ id: early.id, customerId: "cust_test_0001", amountCents: 4321 });
  });

  it("rejects malformed date filters", async () => {
    const ctx = createContext();
    await expectRefundError(ctx.service.listRefunds({ user: reviewer, filter: { from: "2026-13-01" } }), "validation");
    await expectRefundError(ctx.service.listRefunds({ user: reviewer, filter: { to: "yesterday" } }), "validation");
  });
});
