import { describe, expect, it } from "vitest";

import * as auditLogModule from "../src/index";
import { InMemoryAuditLogStore, createAuditLog } from "../src/index";
import type { AuditEvent } from "../src/index";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function freshLog() {
  return createAuditLog(new InMemoryAuditLogStore());
}

function refundApproval(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    actor: "alice@example.test",
    action: "refund.approved",
    entityType: "refund_request",
    entityId: "rr_1",
    before: { status: "pending" },
    after: { status: "approved" },
    ...overrides,
  };
}

describe("recordAuditEvent", () => {
  it("returns a record with a UUID id, ISO 8601 timestamp and actorType defaulting to human", async () => {
    const { recordAuditEvent } = freshLog();

    const record = await recordAuditEvent(refundApproval());

    expect(record.id).toMatch(UUID_V4);
    expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(record.timestamp).toISOString()).toBe(record.timestamp);
    expect(record.actorType).toBe("human");
  });

  it("stores an agent event with actorType agent and onBehalfOf intact", async () => {
    const { recordAuditEvent, queryAuditLog } = freshLog();

    const record = await recordAuditEvent(
      refundApproval({
        actor: "agent:refund-bot",
        actorType: "agent",
        onBehalfOf: "alice@example.test",
        entityId: "rr_agent",
      }),
    );

    expect(record.actorType).toBe("agent");
    expect(record.onBehalfOf).toBe("alice@example.test");

    const [queried] = await queryAuditLog({ entityId: "rr_agent" });
    expect(queried?.actorType).toBe("agent");
    expect(queried?.onBehalfOf).toBe("alice@example.test");
  });
});

describe("queryAuditLog", () => {
  it("filters by entityId", async () => {
    const { recordAuditEvent, queryAuditLog } = freshLog();
    await recordAuditEvent(refundApproval({ entityId: "rr_1" }));
    await recordAuditEvent(refundApproval({ entityId: "rr_2" }));

    const results = await queryAuditLog({ entityId: "rr_2" });

    expect(results.map((record) => record.entityId)).toEqual(["rr_2"]);
  });

  it("filters by actor", async () => {
    const { recordAuditEvent, queryAuditLog } = freshLog();
    await recordAuditEvent(refundApproval({ actor: "alice@example.test" }));
    await recordAuditEvent(refundApproval({ actor: "bob@example.test", entityId: "rr_2" }));

    const results = await queryAuditLog({ actor: "bob@example.test" });

    expect(results.map((record) => record.actor)).toEqual(["bob@example.test"]);
  });
});

describe("public API surface", () => {
  it("exports exactly the allowed runtime values", () => {
    const runtimeExports = Object.entries(auditLogModule)
      .filter(([, value]) => value !== undefined)
      .map(([name]) => name)
      .sort();

    expect(runtimeExports).toEqual([
      "InMemoryAuditLogStore",
      "createAuditLog",
      "queryAuditLog",
      "recordAuditEvent",
    ]);
    expect(Object.keys(freshLog()).sort()).toEqual(["queryAuditLog", "recordAuditEvent"]);
  });
});

describe("immutability", () => {
  it("keeps stored records unchanged when a caller mutates what it received", async () => {
    const { recordAuditEvent, queryAuditLog } = freshLog();
    const record = await recordAuditEvent(refundApproval());

    expect(() => {
      (record as { actor: string }).actor = "mallory@example.test";
    }).toThrow(TypeError);
    expect(() => {
      (record.after as { status: string }).status = "denied";
    }).toThrow(TypeError);

    const [stored] = await queryAuditLog({ entityId: "rr_1" });
    expect(stored?.actor).toBe("alice@example.test");
    expect(stored?.after).toEqual({ status: "approved" });
  });
});
