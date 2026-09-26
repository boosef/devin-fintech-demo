# @acme/refunds-dashboard

Internal dashboard for the refunds ops team to review refund requests. It
replaces a Power Apps canvas app. **This is a POC**: it is meant to be clean,
working and honest about what's missing, not production-grade. All data is
synthetic.

Next.js (App Router), TypeScript `strict`, SQLite via Drizzle ORM and
`better-sqlite3`, built on the shared `@acme/audit-log` and `@acme/auth-guard`
packages.

## Setup

From the repo root:

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

Status codes: `403` no reviewer/admin role, `400` validation (e.g. empty deny
reason), `404` unknown id, `409` already reviewed, `500` audit write failed
(the request stays pending).

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

## Out of scope

- Real SSO / IdP integration
- Real KMS/HSM, key rotation
- Any real payment processor or money movement: approving only changes a
  status
- Multi-tenant support
- Maker-checker (requester ≠ approver, or dual approval above a threshold)
- Searching or sorting by encrypted fields (customer id, amount)
- Postgres: production would migrate from SQLite, not built here
