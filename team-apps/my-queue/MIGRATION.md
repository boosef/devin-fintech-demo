# Migration: "My Refund Queue" legacy HTML tool → team-apps/my-queue

The legacy tool was a single self-contained HTML file: pasted export data plus a
localStorage overlay for notes and "done" ticks, with a fake refresh call to an
internal export endpoint guarded by a token pasted into the source. It is
replaced by a thin tool whose refund data and decisions go through the core
`/api/v1/refunds` API, and whose own data (notes, its audit trail) lives in the
tool's own SQLite database. The legacy file is not committed; none of its
embedded data, token, or endpoint was carried over.

## Part 1 — Inventory

| Legacy feature | Where it lived | Disposition in the migrated tool |
| --- | --- | --- |
| `EXPORT_DATA` pasted rows | embedded `const` in the HTML file | Dropped. Queue data comes from `GET /api/v1/refunds?assignedTo=me` via the tool server. No legacy data imported. |
| `API_TOKEN` / `API_URL` (`DEMO-FAKE-TOKEN-…`, `refunds-export.internal…`) | embedded `const`s | Eliminated. Not committed anywhere. The tool calls the core API with forwarded caller identity headers. |
| `MY_NAME` hard-coded reviewer | embedded `const` | Replaced by a dev persona picker; the tool server forwards `x-mock-role` / `x-mock-user-id` to the core API verbatim. Production: token exchange (on-behalf-of). |
| "My open cases / Over 3 days old / Total $ waiting" cards | client-side over pasted data | Server-side summary over API items: `openCount` = items returned, `overdueCount` = items the API marked `overdue`, `totalCents` = sum of numeric `amountCents`. |
| Oldest-first ordering | `localeCompare` on dd/mm/yyyy strings | `orderQueue()` sorts by `Date.parse(requestedAt)` — real timestamps. |
| Per-case notes (localStorage `note_*`) | browser | Tool's own `notes` SQLite table, append-only, one audit record per add (record carries counts, never the body). **Existing localStorage notes are NOT imported — re-enter them.** |
| "Done" tick (localStorage `done_*`) | browser | Replaced by core `POST /api/v1/refunds/:id/approve` / `:id/deny`. No local done flag. |
| Show/hide done toggle | browser | Dropped — decided items leave the pending queue (the API's status filter covers viewing them). |
| "Copy for weekly report" clipboard export | browser | DROPPED. Not built. |
| `refreshFromApi()` fetch with bearer token | browser | Tool server proxies `/api/queue` → core API; no token in the client. |
| `tr.innerHTML` row rendering with raw interpolation | browser | `src/render.ts` escapes every interpolated value (`escapeHtml`) before innerHTML. |

## Part 2 — Defects and risks

| # | Defect / risk in the legacy tool | How it is handled now |
| --- | --- | --- |
| 1 | Oldest-first sort compared `dd/mm/yyyy` strings, so early days of a later month sorted before older rows. | Fixed: sort by parsed timestamp. Regression test: `tests/queue.test.ts` (items spanning Aug/Sep). |
| 2 | `parseFloat("1,250.00")` → `1.25`, silently dropping ~99.9% of large amounts from the "total waiting" card. | Fixed: sum `amountCents` (integer cents) from the API; format only for display. Regression test: `tests/queue.test.ts`. |
| 3 | Reason/customer/notes interpolated into `innerHTML` — stored XSS by any markup in those fields. | Fixed: all values escaped in `src/render.ts`. Regression test: `tests/render.test.ts`. |
| 4 | A live API token (`DEMO-FAKE-TOKEN-…`) shipped in a file pasted between employees — shared credential, no rotation. | Eliminated: no token anywhere; identity is forwarded headers (dev) / token exchange (prod gap, see README). |
| 5 | Data source was a fake/unreachable endpoint (`refunds-export.internal…`) plus stale pasted exports. | Real calls to `/api/v1/refunds`; no pasted data path remains. |
| 6 | Notes and "done" state lived in localStorage — cleared with browser history, invisible to anyone else, never audited. | Notes persist server-side in the tool DB and each add is audited through the tool's own `createAuditLog(store)`; "done" is a real core decision with the core audit record. |
| 7 | "Done" hid a case locally while the refund stayed pending in the system of record. | Gone: only core approve/deny change a case's status; the core 409 blocks double decisions. |
| 8 | XSS payloads in legacy data would execute in reviewers' browsers. | Same as #3 — escaped rendering, tested. |
| — | **New (accepted) risk:** notes are stored in PLAINTEXT for this POC — the crypto module is app-local to refunds-dashboard and must not be imported. | UI warns "don't put customer data in notes"; README lists promoting crypto to a shared `@acme` package as the production gap. |
| — | **New (accepted) risk:** the tool trusts forwarded `x-mock-*` headers; any caller can claim any persona. | Same trust model as the core API's mock auth in this demo; production gap is on-behalf-of token exchange. |
