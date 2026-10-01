import { describe, expect, it } from "vitest";

import { createCoreClient, type CoreResult } from "../src/core-api";

import { createApp, fakeCore, openTestContext, request, REVIEWER_HEADERS } from "./helpers";

describe("approve/deny via the core API (test 6)", () => {
  it("forwards the caller's identity headers to the core API unchanged", async () => {
    const seen: { url?: string; headers?: Record<string, string>; body?: string } = {};
    const fetchImpl = async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
      seen.url = url;
      seen.headers = init?.headers;
      seen.body = init?.body;
      return { status: 200, json: () => Promise.resolve({ items: [] }) };
    };
    const core = createCoreClient({ baseUrl: "http://core.example", fetchImpl });

    await core.listMine({ role: "reviewer", userId: "demo-reviewer" });

    expect(seen.url).toBe("http://core.example/api/v1/refunds?assignedTo=me");
    expect(seen.headers).toMatchObject({
      "x-mock-role": "reviewer",
      "x-mock-user-id": "demo-reviewer",
    });
  });

  it("approves through the core API and surfaces the core 409 on a second attempt", async () => {
    const { core, calls } = fakeCore({
      approve: [
        { status: 200, body: { id: "rf_1", status: "approved", reviewedBy: "demo-reviewer" } },
        { status: 409, body: { error: "conflict", message: "Refund request rf_1 has already been reviewed." } },
      ],
    });
    const ctx = openTestContext();
    const app = createApp({ core, db: ctx.db, auditLog: ctx.auditLog });

    const first = await app.handle(
      request({ method: "POST", url: "/api/queue/rf_1/approve", headers: REVIEWER_HEADERS, body: { note: "ok" } }),
    );
    const second = await app.handle(
      request({ method: "POST", url: "/api/queue/rf_1/approve", headers: REVIEWER_HEADERS, body: { note: "ok" } }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: "conflict" });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      method: "approve",
      id: "rf_1",
      identity: { role: "reviewer", userId: "demo-reviewer" },
      payload: { note: "ok" },
    });
  });

  it("denies through the core API and surfaces the core 409 on a second attempt", async () => {
    const { core } = fakeCore({
      deny: [
        { status: 200, body: { id: "rf_2", status: "denied" } },
        { status: 409, body: { error: "conflict", message: "Refund request rf_2 has already been reviewed." } } satisfies CoreResult,
      ],
    });
    const ctx = openTestContext();
    const app = createApp({ core, db: ctx.db, auditLog: ctx.auditLog });

    const first = await app.handle(
      request({ method: "POST", url: "/api/queue/rf_2/deny", headers: REVIEWER_HEADERS, body: { reason: "expired" } }),
    );
    const second = await app.handle(
      request({ method: "POST", url: "/api/queue/rf_2/deny", headers: REVIEWER_HEADERS, body: { reason: "expired" } }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
  });
});
