# My Refund Queue (team app)

A reviewer's personal refund queue, migrated from a locally built HTML tool.
It is an employee-built tool under `team-apps/` — it owns only its own data and
reaches core refund data exclusively through the core app's published API.

## How it talks to the core system

All refund data and all approve/deny actions go through the core
`/api/v1/refunds` API (`apps/refunds-dashboard`). The tool never opens the core
database file, never imports from `apps/**` (the lint boundary rule forbids it),
and keeps no copy of core data.

- `GET /api/queue` → `GET {REFUNDS_API_URL}/api/v1/refunds?assignedTo=me`
- `POST /api/queue/:id/approve` → `POST /api/v1/refunds/:id/approve`
- `POST /api/queue/:id/deny` → `POST /api/v1/refunds/:id/deny`

`ageDays`/`overdue` come from the API response; the tool does not recompute them.
`assignedTo=me` is resolved to the caller's id by the core API, server-side.

## Identity

The tool performs no role logic of its own. Whatever `x-mock-role` /
`x-mock-user-id` headers the caller sent are forwarded verbatim on every core
call (`src/identity.ts`), and the core API authorizes — a 403/409 is surfaced
to the UI unchanged and nothing is decided locally.

**Production gap:** mock headers are a dev stand-in. Production would use a
token exchange (on-behalf-of) so the tool calls the core API as a service
identity acting for the verified end user.

## Notes — the tool's own data

Notes live in the tool's own SQLite database (`data/my-queue.db`, table
`notes`). They are append-only — no edit or delete path exists. Each note add
is audited through the tool's own `createAuditLog(new ToolAuditLogStore(db))`;
the audit record's before/after carry the running note count only, never the
note body.

**Notes are stored in PLAINTEXT for this POC** because the crypto module is
app-local to `refunds-dashboard` and must not be imported. The UI warns:
**don't put customer data in notes**. Production gap: promote the crypto
module to a shared `@acme` package and encrypt note bodies at rest.

**Existing `localStorage` notes from the legacy tool are not imported** —
re-enter them by hand.

## Dropped features

Weekly report / clipboard copy export: dropped, not built. The legacy tool
itself (single HTML file) is not committed; none of its embedded data, token,
or endpoint was carried over — see `MIGRATION.md`.

## Rendering

All dynamic values (reason, customer id, note bodies) pass through
`escapeHtml` in `src/render.ts` before reaching `innerHTML` — nothing is
injected as raw markup. The render module is compiled to `public/render.js`
by `pnpm build` (or `pnpm dev`) and is covered by the XSS regression tests.

## Run it

Prerequisite: the core app running with mock auth —

```bash
cd apps/refunds-dashboard && pnpm dev          # :3000
```

Then:

```bash
cd team-apps/my-queue
pnpm dev                                        # :3200
```

Environment overrides:

| var | default | purpose |
| --- | --- | --- |
| `REFUNDS_API_URL` | `http://localhost:3000` | core API base URL |
| `MY_QUEUE_PORT` | `3200` | tool server port |
| `MY_QUEUE_DB` | `data/my-queue.db` | tool's own SQLite file |

The UI's "Viewing as" picker sends the persona's mock headers — a dev
convenience standing in for real sign-in.

## Tests

`pnpm test` (also part of the repo gate via `pnpm test:ci`): oldest-first sort
across months, numeric-cents totals, XSS escaping, note persistence +
append-only + body-free audit record, core 403 surfaced without local state
change, and approve/deny passthrough including the core 409.
