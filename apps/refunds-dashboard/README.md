# @acme/refunds-dashboard

Internal dashboard for the refunds ops team to review refund requests. It
replaces a Power Apps canvas app. **This is a POC**: it is meant to be clean,
working and honest about what's missing, not production-grade. All data is
synthetic.

Next.js (App Router), TypeScript `strict`, SQLite via Drizzle ORM and
`better-sqlite3`, built on the shared `@acme/audit-log` and `@acme/auth-guard`
packages.

## Setup

From the repo root (see the [root README](../../README.md#getting-started) for
Node 22 and pnpm 12.6.0 setup):

```bash
pnpm install

cd apps/refunds-dashboard
cp .env.example .env.local
# put a real key in .env.local:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

pnpm db:seed    # wipes data/refunds.db and inserts 18 synthetic requests (stop `pnpm dev` first)
pnpm dev        # http://localhost:3000
```

`.env.local` needs:

| Variable | Notes |
| --- | --- |
| `REFUNDS_ENCRYPTION_KEY` | 32 random bytes, base64. The app fails fast with a clear error if it is missing or the wrong length. Server-only: never `NEXT_PUBLIC_`. |
| `MOCK_AUTH_ENABLED` | Must be exactly `true` (lowercase). `1` or `TRUE` disable mock auth, and every page and action is then rejected. |

Pick a role with the **Viewing as** selector in the header (reviewer / admin /
no role).

### Tests, lint, typecheck, build

```bash
# from the repo root: the app's tests run as the @acme/refunds-dashboard project
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @acme/refunds-dashboard build
```

Tests target the service layer, crypto module and SQLite audit store, each
against a fresh temporary SQLite file. They don't need `.env.local`.

### Schema changes

`src/db/schema.ts` is the source of truth. After changing it, run
`pnpm db:generate` and commit the new SQL under `drizzle/`. Migrations are
applied when the database is opened.

## Layout

```
src/db/                 Drizzle schema, connection + migrations
src/lib/refunds/        service.ts: all business rules (listRefunds, approveRefund, denyRefund, listAuditTrail)
src/lib/audit/          SqliteAuditLogStore (implements AuditLogStore from @acme/audit-log)
src/lib/auth/           cookie -> @acme/auth-guard bridge, dev-only "Viewing as" action
src/lib/crypto/         AES-256-GCM field encryption
src/app/                pages, server actions, route handlers (thin wrappers over the service)
```

Route handlers (JSON body required, HTTP status from the service error):

- `POST /api/refunds/:id/approve` `{ "note"?: string }`
- `POST /api/refunds/:id/deny` `{ "reason": string }`

The API uses the same `mock_role` and `mock_user_id` cookies as the UI, not
caller-supplied role headers. With `MOCK_AUTH_ENABLED=true`, choose a pending
request ID from the Requests page and call, for example:

```bash
REFUND_ID="paste-a-pending-request-id-here"
curl -i -X POST "http://localhost:3000/api/refunds/$REFUND_ID/deny" \
  -H 'Content-Type: application/json' \
  --cookie 'mock_role=reviewer; mock_user_id=demo-reviewer' \
  --data '{"reason":"Duplicate charge"}'
```

Status codes: `403` no reviewer/admin role (or mock auth disabled), `400`
invalid JSON or validation (e.g. empty deny reason), `404` unknown id, `409`
already reviewed, `415` non-JSON content type, `500` audit write failed (the
request stays pending).

## Team-app API: `/api/v1/refunds`

**This versioned JSON API is the ONLY interface team-apps (employee-built
tools under `team-apps/`) may depend on.** Team apps may not import from
`apps/**` or open this database. `pnpm lint` rejects imports from `apps/**`;
database access must also be checked in review. The older unversioned routes
above exist for the dashboard itself and are not a supported contract. See
the [team-app workflow](../../PLAYBOOK.md#6-building-or-migrating-a-team-app)
for a repeatable setup and quality-gate checklist.

Identity for API callers comes from the forwarded `x-mock-role` /
`x-mock-user-id` headers, read by `getMockUser` from `@acme/auth-guard`;
`hasRole` then requires `reviewer` or `admin` on every route.

**Production gap:** identity is forwarded mock headers today — any caller can
claim any role. These headers work only with `MOCK_AUTH_ENABLED=true` and are
for synthetic development data. Production would authenticate the caller and
run a token exchange (on-behalf-of) so the API receives a verifiable identity,
not headers.

To simulate a server-side client locally, list the mock reviewer's own queue:

```bash
curl -i -H 'x-mock-role: reviewer' -H 'x-mock-user-id: demo-reviewer' \
  'http://localhost:3000/api/v1/refunds?assignedTo=me'
```

The dashboard UI's `mock_role` / `mock_user_id` cookies apply to its own
unversioned routes; they do not authenticate a request to this versioned API.

### `GET /api/v1/refunds`

Query params:

| Param | Shape | Notes |
| --- | --- | --- |
| `status` | `pending` \| `approved` \| `denied` \| `all` | defaults to `pending`; anything else is `400` |
| `from` / `to` | `YYYY-MM-DD` | inclusive UTC day bounds on `requestedAt`; malformed dates are `400` |
| `assignedTo` | `me` or a reviewer id | `me` resolves to the caller's mock id **server-side**; an explicit reviewer id is a filter, not a per-assignee permission check |

Response `200`: `{ "items": RefundItem[] }`, oldest request first, where each
item is the decrypted record plus two server-computed fields:

```json
{
  "id": "…",
  "customerId": "cust_demo_0001",
  "amountCents": 1250,
  "reason": "Duplicate charge on statement",
  "status": "pending",
  "requestedAt": "2026-09-20T10:00:00.000Z",
  "assignedTo": "demo-reviewer",
  "reviewedBy": null,
  "reviewedAt": null,
  "decisionReason": null,
  "ageDays": 6,
  "overdue": true
}
```

`ageDays` is whole days since `requestedAt` against the server's clock
(injectable `now()` in `src/lib/refunds/api-v1.ts`); `overdue` is
`ageDays > SLA_DAYS` with `SLA_DAYS = 3` in `src/lib/refunds/sla.ts`.

### `POST /api/v1/refunds/:id/approve` and `POST /api/v1/refunds/:id/deny`

JSON body: `{ "note"?: string }` for approve, `{ "reason": string }`
(required, non-empty) for deny. Response `200` is the same `RefundItem` shape
as above, post-review. These are thin wrappers over the same
`approveRefund`/`denyRefund` service functions the dashboard uses: a request
leaves `pending` exactly once and every decision writes exactly one audit
record containing only `status`, `reviewed_by`, `reviewed_at` and
`decision_reason` — never the customer id or amount.

For a local pending `REFUND_ID` returned by the list call, approve it with:

```bash
curl -i -X POST "http://localhost:3000/api/v1/refunds/$REFUND_ID/approve" \
  -H 'x-mock-role: reviewer' -H 'x-mock-user-id: demo-reviewer' \
  -H 'Content-Type: application/json' --data '{"note":"Reviewed"}'
```

Error responses everywhere are `{ "error": string, "message": string }`:
`403` no reviewer/admin role, `400` validation (bad status/date, empty deny
reason), `404` unknown id, `409` already reviewed, `415` non-JSON content
type, `500` unexpected error or audit write failure (the request stays pending
if the audit write fails).

## Rules the service enforces

- Only `reviewer` or `admin` (via `hasRole` from `@acme/auth-guard`) can list
  requests, view the audit trail, approve or deny. The UI hiding buttons is
  cosmetic; the check is inside every service function.
- Deny needs a non-empty `decision_reason`; approve takes an optional note.
- A request leaves `pending` exactly once:
  `UPDATE ... WHERE id = ? AND status = 'pending'`. If no row changes, the
  caller gets a conflict (HTTP 409), so two reviewers can't both act.
- Every approve/deny writes one audit record through
  `createAuditLog(store).recordAuditEvent`. `before`/`after` contain only
  `status`, `reviewed_by`, `reviewed_at` and `decision_reason`, never the
  customer id or amount.

## Encryption

`customer_id_enc` and `amount_cents_enc` hold AES-256-GCM ciphertext
(Node `crypto`, random 12-byte IV per value), stored as
`v1:<iv b64>:<authTag b64>:<ciphertext b64>`. The amount is encrypted as a
decimal string and parsed back to an integer in the service layer. Tampering
with the ciphertext or tag makes decryption throw. Decrypted values only exist
on the server and are rendered into the HTML for authorised users.

Because they're encrypted, these columns can't be filtered, sorted or searched
in SQL. The filters (status, requested date) use plaintext columns.

**Production gap:** the key is one static env var. Production would use a
KMS/HSM with envelope encryption (per-record or per-tenant data keys wrapped
by a KMS key), key rotation with re-encryption (the `v1:` prefix leaves room
for that), and access-logged decryption.

Changing `REFUNDS_ENCRYPTION_KEY` does not rotate existing ciphertext: rows
encrypted with the old key can no longer be decrypted with the new one. For
this **synthetic local database only**, stop `pnpm dev` and re-run `pnpm db:seed`
from this app directory after changing the key. Seeding deletes the local
database (including decisions and audit records) and creates fresh requests;
it is not a data-preserving rotation procedure.

## Auth

`src/lib/auth/current-user.ts` reads the `mock_role` / `mock_user_id` cookies,
copies them as-is into the `x-mock-role` / `x-mock-user-id` headers of a
`Request`, and passes that to `getMockUser` from `@acme/auth-guard`. It does no
role checking of its own. The cookies are set by the **Viewing as** selector,
which only renders, and only works, when `NODE_ENV !== "production"`.

**Production gap:** this is not authentication. Production needs real SSO
(OIDC with the corporate IdP), validated session/JWT, IdP group-to-role
mapping, and session expiry/revocation. The "Viewing as" selector is dev-only
and must never ship.

## Audit

The audit trail uses `createAuditLog(new SqliteAuditLogStore(db))`.
`SqliteAuditLogStore` implements the shared package's `AuditLogStore`
interface (`append` and `query` only) against the `audit_records` table in
the same SQLite file, so the trail survives restarts. This is the
"swap the store behind the same interface" the audit-log README describes,
not a separate audit mechanism. It never updates or deletes rows, and returned
records are deep-frozen.

The status change and its audit record succeed or fail together: if the audit
write throws, the service reverts the request to pending and returns an
error.

**Production gap:** that's a compensating write, not atomicity; a crash
between the two steps could leave a decision without an audit record.
Production would write both in a single database transaction or through a
transactional outbox, on Postgres (this app would migrate from SQLite to
Postgres), with the app's DB role granted INSERT/SELECT only on the audit
table, plus retention and tamper evidence. `db:seed` deletes the local dev
database file; nothing in the app itself removes audit rows.

## Manual admin steps

These need a repository admin; nothing in code can do them:

1. In `.github/CODEOWNERS`, replace the placeholder slugs
   `@acme-org/platform-team` (owns `/apps/`) and
   `@acme-org/security-reviewers` with real GitHub teams that have write
   access to this repository.
2. Until that happens, GitHub's CODEOWNERS check reports an **"unknown owner"
   error** for those slugs — this is expected, not a defect in the file.

## Out of scope

- Real SSO / IdP integration
- Real KMS/HSM, key rotation
- Any real payment processor or money movement: approving only changes a
  status
- Multi-tenant support
- Maker-checker (requester ≠ approver, or dual approval above a threshold)
- Searching or sorting by encrypted fields (customer id, amount)
- Postgres: production would migrate from SQLite, not built here
