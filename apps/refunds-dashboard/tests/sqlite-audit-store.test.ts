import { createAuditLog } from "@acme/audit-log";
import { describe, expect, it } from "vitest";

import { SqliteAuditLogStore } from "@/lib/audit/sqlite-store";

import { openTestDb, tempDbFile } from "./helpers/context";

describe("SqliteAuditLogStore", () => {
  it("persists records across store instances, returns frozen records and has no update/delete", async () => {
    const file = tempDbFile();
    const first = createAuditLog(new SqliteAuditLogStore(openTestDb(file)));
    const written = await first.recordAuditEvent({
      actor: "rev-1",
      action: "refund.approved",
      entityType: "refund_request",
      entityId: "rr_1",
      before: { status: "pending" },
      after: { status: "approved" },
    });

    const reopened = new SqliteAuditLogStore(openTestDb(file));
    const records = await createAuditLog(reopened).queryAuditLog({ entityId: "rr_1" });
    expect(records).toEqual([written]);

    const [record] = records;
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record?.after)).toBe(true);

    const methods = Object.getOwnPropertyNames(SqliteAuditLogStore.prototype).filter((name) => name !== "constructor");
    expect(methods.sort()).toEqual(["append", "query"]);
  });
});
