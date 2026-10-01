import { describe, expect, it } from "vitest";

import { listNotes } from "../src/notes";

import { createApp, fakeCore, openTestContext, request } from "./helpers";

describe("authorization (test 5)", () => {
  it("surfaces the core API's 403 and changes nothing locally", async () => {
    const ctx = openTestContext();
    const { core, calls } = fakeCore({
      listMine: [{ status: 403, body: { error: "forbidden", message: "Only a reviewer or admin can do this." } }],
      approve: [{ status: 403, body: { error: "forbidden", message: "Only a reviewer or admin can do this." } }],
    });
    const app = createApp({ core, db: ctx.db, auditLog: ctx.auditLog });

    const list = await app.handle(request({ method: "GET", url: "/api/queue" }));
    expect(list.status).toBe(403);
    expect(list.body).toMatchObject({ error: "forbidden" });

    const approve = await app.handle(request({ method: "POST", url: "/api/queue/rf_1/approve", body: {} }));
    expect(approve.status).toBe(403);

    // The tool forwarded a null identity and never decided anything itself.
    expect(calls[0]?.identity).toEqual({ role: null, userId: null });
    expect(listNotes(ctx.db)).toEqual([]);
    expect(await ctx.auditLog.queryAuditLog({})).toEqual([]);
  });
});
