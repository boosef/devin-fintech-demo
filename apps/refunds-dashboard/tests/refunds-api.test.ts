import type { MockUser } from "@acme/auth-guard";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { auditRecords, refundRequests } from "@/db/schema";
import { createRefundsApiV1, type RefundItem } from "@/lib/refunds/api-v1";
import { SLA_DAYS } from "@/lib/refunds/sla";

import { admin, createContext, insertRefund, reviewer } from "./helpers/context";

const FIXED_NOW = new Date("2026-09-26T12:00:00.000Z");

const demoReviewer: MockUser = { id: "demo-reviewer", email: "demo-reviewer@example.test", role: "reviewer" };
const demoAdmin: MockUser = { id: "demo-admin", email: "demo-admin@example.test", role: "admin" };

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeApi() {
  const ctx = createContext();
  return { ctx, api: createRefundsApiV1({ service: ctx.service, now: () => FIXED_NOW }) };
}

function apiRequest(
  path: string,
  options: { user?: MockUser | { id: string; role: string }; method?: "GET" | "POST"; body?: unknown } = {},
): Request {
  vi.stubEnv("MOCK_AUTH_ENABLED", "true");
  const headers = new Headers();
  if (options.user) {
    headers.set("x-mock-user-id", options.user.id);
    headers.set("x-mock-role", options.user.role);
  }
  const init: RequestInit = { method: options.method ?? "GET", headers };
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(options.body);
  }
  return new Request(`https://refunds.internal${path}`, init);
}

async function json(res: Response): Promise<{ items?: RefundItem[] } & Record<string, unknown>> {
  return (await res.json()) as { items?: RefundItem[] } & Record<string, unknown>;
}

describe("GET /api/v1/refunds", () => {
  it.each([
    ["no user at all", undefined],
    ["a user without a reviewer/admin role", { id: "intern-1", role: "viewer" }],
  ])("returns 403 for %s", async (_label, user) => {
    const { api } = makeApi();

    const res = await api.list(apiRequest("/api/v1/refunds", { user }));

    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ error: "forbidden" });
  });

  it("resolves assignedTo=me to the caller's id server-side and keeps queues disjoint", async () => {
    const { ctx, api } = makeApi();
    const mine = [
      insertRefund(ctx.db, { assignedTo: demoReviewer.id }),
      insertRefund(ctx.db, { assignedTo: demoReviewer.id }),
    ];
    const theirs = [
      insertRefund(ctx.db, { assignedTo: demoAdmin.id }),
      insertRefund(ctx.db, { assignedTo: demoAdmin.id }),
    ];
    insertRefund(ctx.db, { assignedTo: null });

    const mineRes = await json(await api.list(apiRequest("/api/v1/refunds?assignedTo=me", { user: demoReviewer })));
    const theirsRes = await json(await api.list(apiRequest("/api/v1/refunds?assignedTo=me", { user: demoAdmin })));

    const myIds = (mineRes.items ?? []).map((i) => i.id);
    const theirIds = (theirsRes.items ?? []).map((i) => i.id);
    expect(myIds.sort()).toEqual(mine.map((r) => r.id).sort());
    expect(theirIds.sort()).toEqual(theirs.map((r) => r.id).sort());
    expect(myIds.filter((id) => theirIds.includes(id))).toEqual([]);
    for (const item of mineRes.items ?? []) expect(item.assignedTo).toBe(demoReviewer.id);
  });

  it("filters by status and date range like the service", async () => {
    const { ctx, api } = makeApi();
    const early = insertRefund(ctx.db, { requestedAt: "2026-08-15T10:00:00.000Z" });
    const mid = insertRefund(ctx.db, { requestedAt: "2026-09-10T23:59:59.000Z" });
    insertRefund(ctx.db, { requestedAt: "2026-09-20T00:00:00.000Z" });
    const approved = insertRefund(ctx.db, { status: "approved", requestedAt: "2026-09-10T12:00:00.000Z" });

    const approvedRes = await json(
      await api.list(apiRequest("/api/v1/refunds?status=approved", { user: reviewer })),
    );
    expect((approvedRes.items ?? []).map((i) => i.id)).toEqual([approved.id]);

    const ranged = await json(
      await api.list(apiRequest("/api/v1/refunds?status=pending&from=2026-09-01&to=2026-09-10", { user: reviewer })),
    );
    expect((ranged.items ?? []).map((i) => i.id)).toEqual([mid.id]);

    const all = await json(
      await api.list(apiRequest("/api/v1/refunds?status=all&from=2026-08-01&to=2026-09-15", { user: reviewer })),
    );
    expect((all.items ?? []).map((i) => i.id).sort()).toEqual([early.id, mid.id, approved.id].sort());

    const badDate = await api.list(apiRequest("/api/v1/refunds?from=not-a-date", { user: reviewer }));
    expect(badDate.status).toBe(400);
    expect(await json(badDate)).toMatchObject({ error: "validation" });
  });

  it("computes ageDays and overdue server-side from the injected now()", async () => {
    const { ctx, api } = makeApi();
    const fresh = insertRefund(ctx.db, { requestedAt: "2026-09-26T11:00:00.000Z" }); // 0d
    const atSla = insertRefund(ctx.db, { requestedAt: "2026-09-23T12:00:00.000Z" }); // exactly SLA_DAYS
    const over = insertRefund(ctx.db, { requestedAt: "2026-09-22T11:59:59.000Z" }); // 4d
    const old = insertRefund(ctx.db, { requestedAt: "2026-09-01T00:00:00.000Z" }); // 25d

    const res = await json(await api.list(apiRequest("/api/v1/refunds?status=pending", { user: reviewer })));
    const byId = new Map((res.items ?? []).map((i) => [i.id, i]));

    expect(byId.get(fresh.id)).toMatchObject({ ageDays: 0, overdue: false });
    expect(byId.get(atSla.id)).toMatchObject({ ageDays: SLA_DAYS, overdue: false });
    expect(byId.get(over.id)).toMatchObject({ ageDays: SLA_DAYS + 1, overdue: true });
    expect(byId.get(old.id)).toMatchObject({ ageDays: 25, overdue: true });
  });

  it("lists oldest-first by real timestamp across months (bug #1 regression)", async () => {
    const { ctx, api } = makeApi();
    // inserted newest-to-oldest on purpose: storage order must not win
    const newest = insertRefund(ctx.db, { requestedAt: "2026-09-20T00:00:00.000Z" });
    const middle = insertRefund(ctx.db, { requestedAt: "2026-08-05T12:00:00.000Z" });
    const oldest = insertRefund(ctx.db, { requestedAt: "2026-07-01T00:00:00.000Z" });

    const res = await json(await api.list(apiRequest("/api/v1/refunds?status=pending", { user: reviewer })));

    expect((res.items ?? []).map((i) => i.id)).toEqual([oldest.id, middle.id, newest.id]);
  });
});

describe("POST /api/v1/refunds/:id/approve and /deny", () => {
  it("approve returns the reviewed record and writes exactly one audit record with only review fields", async () => {
    const { ctx, api } = makeApi();
    const { id, customerId, amountCents } = insertRefund(ctx.db, {
      customerId: "cust_secret_4242",
      amountCents: 777001,
    });

    const res = await api.approve(apiRequest(`/api/v1/refunds/${id}/approve`, { user: reviewer, method: "POST", body: { note: "ok" } }), id);

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({
      id,
      status: "approved",
      reviewedBy: reviewer.id,
      customerId,
      amountCents,
    });

    const records = ctx.db.select().from(auditRecords).where(eq(auditRecords.entityId, id)).all();
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.actor).toBe(reviewer.id);
    const before = JSON.parse(record.before) as Record<string, unknown>;
    const after = JSON.parse(record.after) as Record<string, unknown>;
    expect(Object.keys(before).sort()).toEqual(["decision_reason", "reviewed_at", "reviewed_by", "status"]);
    expect(Object.keys(after).sort()).toEqual(["decision_reason", "reviewed_at", "reviewed_by", "status"]);
    expect(after).toMatchObject({ status: "approved", reviewed_by: reviewer.id });
    const serialized = JSON.stringify({ before, after });
    expect(serialized).not.toContain(customerId);
    expect(serialized).not.toContain(String(amountCents));
  });

  it("deny returns the reviewed record and audits the decision reason only", async () => {
    const { ctx, api } = makeApi();
    const { id } = insertRefund(ctx.db, { assignedTo: admin.id });

    const res = await api.deny(
      apiRequest(`/api/v1/refunds/${id}/deny`, { user: admin, method: "POST", body: { reason: "outside window" } }),
      id,
    );

    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ id, status: "denied", reviewedBy: admin.id, decisionReason: "outside window" });

    const records = ctx.db.select().from(auditRecords).where(eq(auditRecords.entityId, id)).all();
    expect(records).toHaveLength(1);
    expect(JSON.parse(records[0]!.after)).toMatchObject({ status: "denied", decision_reason: "outside window" });
  });

  it("a second approve or deny returns 409 and changes nothing", async () => {
    const { ctx, api } = makeApi();
    const { id } = insertRefund(ctx.db);

    const first = await api.approve(apiRequest(`/api/v1/refunds/${id}/approve`, { user: reviewer, method: "POST", body: {} }), id);
    expect(first.status).toBe(200);
    const settled = ctx.db.select().from(refundRequests).where(eq(refundRequests.id, id)).get();

    for (const call of [
      () => api.approve(apiRequest(`/api/v1/refunds/${id}/approve`, { user: admin, method: "POST", body: {} }), id),
      () => api.deny(apiRequest(`/api/v1/refunds/${id}/deny`, { user: admin, method: "POST", body: { reason: "late" } }), id),
    ]) {
      const res = await call();
      expect(res.status).toBe(409);
      expect(await json(res)).toMatchObject({ error: "conflict" });
    }

    expect(ctx.db.select().from(refundRequests).where(eq(refundRequests.id, id)).get()).toEqual(settled);
    expect(ctx.db.select().from(auditRecords).where(eq(auditRecords.entityId, id)).all()).toHaveLength(1);
  });

  it("returns 404 for an unknown id and 403 without a role", async () => {
    const { ctx, api } = makeApi();

    const missing = await api.approve(
      apiRequest("/api/v1/refunds/nope/approve", { user: reviewer, method: "POST", body: {} }),
      "nope",
    );
    expect(missing.status).toBe(404);

    const forbidden = await api.deny(
      apiRequest("/api/v1/refunds/nope/deny", { method: "POST", body: { reason: "x" } }),
      "nope",
    );
    expect(forbidden.status).toBe(403);
    expect(ctx.db.select().from(auditRecords).all()).toHaveLength(0);
  });
});
