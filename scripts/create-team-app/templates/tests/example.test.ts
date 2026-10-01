import { describe, expect, it } from "vitest";

import { auditLog } from "../src/index";

describe("{{pkgName}}", () => {
  it("records changes to its own data in its own audit log", async () => {
    const record = await auditLog.recordAuditEvent({
      actor: "user-1",
      action: "{{name}}.example_created",
      entityType: "example",
      entityId: "example-1",
      before: null,
      after: { title: "first" },
    });

    expect(await auditLog.queryAuditLog({ entityId: "example-1" })).toEqual([record]);
  });
});
