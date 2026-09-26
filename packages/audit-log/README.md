# @acme/audit-log

Every app in this monorepo writes audit records through this package instead of
building its own audit logging.

```ts
import { createAuditLog, InMemoryAuditLogStore } from "@acme/audit-log";

const { recordAuditEvent, queryAuditLog } = createAuditLog(
  new InMemoryAuditLogStore(),
);

await recordAuditEvent({
  actor: "alice@example.test",
  action: "refund.approved",
  entityType: "refund_request",
  entityId: "rr_1",
  before: { status: "pending" },
  after: { status: "approved" },
});

await queryAuditLog({ entityId: "rr_1" });
```

## API

- `createAuditLog(store)` → `{ recordAuditEvent, queryAuditLog }`
- `recordAuditEvent(event)` / `queryAuditLog(filter)` — bound to a default
  in-memory instance
- `InMemoryAuditLogStore` — implements the `AuditLogStore` interface
  (`append` / `query` only)

`actorType` defaults to `"human"`; agent actions should set
`actorType: "agent"` and `onBehalfOf: "<the human>"`. Each record gets a
`crypto.randomUUID()` id and an ISO 8601 `timestamp`.

## Append-only by design

The package exports no function that updates, deletes or resets a record or a
store — including test-only helpers such as `__reset`. Tests get isolation by
calling `createAuditLog(new InMemoryAuditLogStore())` per test.
`InMemoryAuditLogStore` `structuredClone`s and deep-freezes each record on
append and returns frozen copies from `query`, so a caller holding a returned
record cannot change what the log contains.

## Production

Production would replace `InMemoryAuditLogStore` with a persistent, append-only
store — e.g. Postgres with INSERT-only grants — behind the same `AuditLogStore`
interface. No persistent store is built here; the in-memory log dies with the
process.
