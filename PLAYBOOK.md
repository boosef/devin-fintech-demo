# PLAYBOOK

How to build on the shared platform layer in this monorepo.

## 1. Adding a platform-owned core app

1. Create the app under `apps/<name>` (e.g. `apps/refunds-dashboard`).
   `pnpm-workspace.yaml` already includes `apps/*`, so pnpm discovers it as a
   workspace package.
2. Add the platform packages as workspace dependencies in
   `apps/<name>/package.json`:

   ```json
   {
     "name": "@acme/refunds-dashboard",
     "private": true,
     "type": "module",
     "dependencies": {
       "@acme/audit-log": "workspace:*",
       "@acme/auth-guard": "workspace:*"
     },
     "scripts": {
       "test": "vitest run"
     }
   }
   ```

3. The packages ship TypeScript source with no build step, so a Next.js app must
   transpile them:

   ```js
   // apps/<name>/next.config.mjs
   export default {
     transpilePackages: ["@acme/audit-log", "@acme/auth-guard"],
   };
   ```

4. Add an app `tsconfig.json` that extends `tsconfig.base.json`, then add
   `tsc -p apps/<name>/tsconfig.json --noEmit` to the root `typecheck` script
   in `package.json`. The root script names
   `apps/refunds-dashboard/tsconfig.json` explicitly; new apps are **not**
   typechecked automatically. Add a `vitest.config.ts` in the app — the root
   `test.projects` glob for `apps/*/vitest.config.ts` picks up its tests, so
   they count towards the quality gate. If the new app has a build, add it to
   the CI workflow as well; CI currently builds the refunds dashboard only.
5. Non-negotiable rules: **every state-changing action is audited** through
   `@acme/audit-log`, and **every route is role-checked** through
   `@acme/auth-guard`. No app-local audit tables and no app-local header
   parsing.
6. Run `pnpm install`, then `pnpm lint && pnpm typecheck && pnpm test` before
   opening a PR, and raise `minPassedTests` (section 4) for the tests you added.

### Publishing a new core API

A new use case belongs in a platform-owned app under `apps/`. Keep route
handlers thin: delegate to an API adapter (with injectable service and clock
for tests), which maps requests and JSON responses onto existing service
methods. Enforce roles at the API boundary *and* in the core service, where
business rules, database access and auditing belong. Publish a versioned JSON
contract under `/api/v1/<resource>` rather than exposing internal modules,
database tables or UI-only routes. Compute derived fields and caller-relative
filters on the core server. Document the query/body shapes, response and error
JSON, role requirements and status codes in the core app's README; keep v1
stable for existing callers, publishing a new version for incompatible changes.
Add tests for the real handler path and service: filtering, identity resolution,
role denial, repeated decisions and the audit record.
`apps/refunds-dashboard/src/lib/refunds/api-v1.ts` and
`apps/refunds-dashboard/tests/refunds-api.test.ts` show the current pattern.

If a team requests a field or action absent from a published API, the platform
team reviews that change in the core app first. Only then should a team app
consume the new contract; keep ownership and tests on each side of the API.

## 2. Using `packages/audit-log`

```ts
import {
  createAuditLog,
  InMemoryAuditLogStore,
  type AuditRecord,
} from "@acme/audit-log";

const { recordAuditEvent, queryAuditLog } = createAuditLog(
  new InMemoryAuditLogStore(),
);

export async function approveRefund(
  refundId: string,
  reviewerEmail: string,
): Promise<AuditRecord> {
  // ... perform the state change, then record it
  return recordAuditEvent({
    actor: reviewerEmail,
    action: "refund.approved",
    entityType: "refund_request",
    entityId: refundId,
    before: { status: "pending" },
    after: { status: "approved" },
  });
}

export async function autoDenyRefund(
  refundId: string,
  onBehalfOf: string,
): Promise<AuditRecord> {
  return recordAuditEvent({
    actor: "agent:refund-triage",
    actorType: "agent",
    onBehalfOf,
    action: "refund.denied",
    entityType: "refund_request",
    entityId: refundId,
    before: { status: "pending" },
    after: { status: "denied", reason: "duplicate charge not found" },
  });
}

export async function refundHistory(refundId: string): Promise<AuditRecord[]> {
  return queryAuditLog({ entityId: refundId });
}
```

Notes:

- `actorType` defaults to `"human"` when omitted; use `"agent"` plus
  `onBehalfOf` for agent-initiated actions.
- Records are immutable: what you get back is deep-frozen, and mutating it
  cannot change the log.
- The package intentionally exposes no update, delete or reset function. Tests
  get isolation by creating a fresh `createAuditLog(new InMemoryAuditLogStore())`
  per test — never by clearing shared state.
- Module-level `recordAuditEvent` / `queryAuditLog` use a process-wide default
  in-memory instance; prefer `createAuditLog` when you want an explicit store.

## 3. Using `packages/auth-guard`

```ts
import { getMockUser, hasRole, type Role } from "@acme/auth-guard";

const ALLOWED: Role[] = ["admin", "reviewer"];

export async function handleRefundApproval(request: Request): Promise<Response> {
  const user = getMockUser(request);
  if (!hasRole(user, ALLOWED)) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  // `user` is non-null here because hasRole rejects null users.
  return Response.json({ approvedBy: user?.email });
}
```

Notes:

- `getMockUser` returns `null` unless `MOCK_AUTH_ENABLED === "true"`; that is a
  hard off-switch, so an environment that has not opted in gets no mock auth
  regardless of headers.
- `hasRole(null, ...)` and `hasRole(user, [])` are both `false`, so the deny
  branch is the default.

## 4. What the quality gate checks, and how to update the test baseline

`.github/workflows/quality-gate.yml` runs on every pull request (no branch
filter, so it also runs on PRs targeting feature branches):

1. `pnpm install --frozen-lockfile` — the lockfile must be committed and current.
2. `pnpm lint` — ESLint flat config; any error fails the build.
3. `pnpm typecheck` — `tsc --noEmit` with `strict: true`; any error fails.
4. `pnpm --filter @acme/refunds-dashboard build` — build the Next.js app.
5. `pnpm test:ci` — Vitest with v8 coverage, writing `test-results.json`.
6. **Test-count baseline guard** — `node scripts/check-test-baseline.mjs`.

The test count includes the app's and CI helper's tests, but the coverage
configuration measures only `packages/*/src/**/*.ts`; app and script coverage
is not measured in this POC.

The guard reads `test-results.json` and `.github/test-baseline.json`
(`{ "minPassedTests": N }`) and is a **ratchet**: the baseline must equal the
passing count exactly, and may only ever go up. It fails if:

- `numPassedTests > minPassedTests` — you added tests but left the baseline
  stale, so a later PR could delete them and still pass. Message:
  `Passed N tests but baseline is M. Raise minPassedTests to N in
  .github/test-baseline.json in this PR.`;
- `numPassedTests < minPassedTests` — tests were deleted, or stopped passing;
- `minPassedTests` is lower than the value on the PR's base branch (read in CI
  with `git show origin/$GITHUB_BASE_REF:.github/test-baseline.json`; a baseline
  that does not exist there yet counts as `0`) — the ratchet was filed down;
- `numPendingTests > 0` or `numTodoTests > 0` — a skipped or todo test counts as
  a removed test, which is why skipping fails the build; or
- `numFailedTests > 0`.

It exists to stop the failure mode where a failing test is "fixed" by deleting
or skipping it instead of fixing the bug — and, with the exact-match and
base-branch rules, to stop the baseline going stale so that deletion becomes
invisible later.

**Raising the baseline:** any PR that adds tests must run `pnpm test:ci`
locally, read the new passing count, and set `minPassedTests` to that exact
number in `.github/test-baseline.json` **in the same PR** — this is not
optional, the build fails without it. Never lower it. `.github/**` is
code-owned, so any change to the baseline requires review from the security
reviewers team.

The guard's own logic is unit-tested in `scripts/tests/`, which runs as the
`scripts` Vitest project and counts towards the same baseline.

## 5. What's explicitly out of scope for this POC

- **Real SSO**: no JWT or session validation, no Entra ID/OIDC integration, no
  IdP group-to-role mapping, no token expiry or revocation. The shared auth
  guard reads mock headers behind an env flag; the dashboard bridges dev-only
  cookies to those headers.
- **Production audit storage**: the shared package's default store is in-memory;
  the dashboard persists audit rows in SQLite. Neither has production DB grants,
  retention policy, tamper evidence (e.g. hash chaining), or SIEM export.
- **Spend/cost governance**: no per-session or per-team ACU budgets, no
  iteration caps, no alerts on agent spend.
- **Agent identity layer**: agents do not get their own scoped, revocable
  credentials; `actorType` and `onBehalfOf` are recorded as claims but are not
  verified.
- **Guardrail/quality-gate depth**: no risk scoring or auto-merge tiers, no
  write-scope enforcement on agent PRs, no SAST or dependency scanning, no
  secret scanning beyond GitHub defaults.

## 6. Building or migrating a team app

Team tools live under `team-apps/<name>/`; `pnpm-workspace.yaml` already
includes `team-apps/*`. Core apps in `apps/` own their APIs and data, and
`packages/` owns shared platform behavior. Follow this sequence for a new
team request or a legacy-tool migration:

1. **Define the use case.** Read `AGENTS.md`, this playbook, `.github/CODEOWNERS`
   and the core app's README. List the needed screens, data and actions against
   its **published API**, not its internal schema. For refunds, use only
   `GET /api/v1/refunds` and `POST /api/v1/refunds/:id/approve|deny` (see the
   refunds dashboard README). Its unversioned routes are for the dashboard
   UI. If the contract lacks something, request a platform-owned API change
   before implementing the team tool; do not read a core database, even for a
   one-off report.
2. **Create the workspace.** Add `team-apps/<name>/package.json` with a unique
   package name and scripts for the app's test/build/dev commands. Add its own
   `README.md` describing setup, the core API URL/configuration, local data
   and how to run it alongside the core app. Use `@acme/audit-log` and
   `@acme/auth-guard` via `"workspace:*"` when the tool needs local auditing
   or access checks; never import a core app module. Add a separate database
   for team-owned data such as notes or preferences, not a connection to a
   core app's SQLite file.
3. **Call the API from your server.** Put requests to the core app behind a
   small server-side client. For the POC, the core API reads forwarded
   `x-mock-role` and `x-mock-user-id` headers when `MOCK_AUTH_ENABLED=true`;
   the dashboard UI's `mock_role` / `mock_user_id` cookies are *not* the
   team-app API contract. Use `assignedTo=me` to let the core resolve the
   caller's id. Do not let a browser supply a trusted user id or role, and
   do not treat the demo headers as real authentication: any caller can forge
   them. A production integration needs validated sessions and on-behalf-of
   tokens. Keep core `403` / `409` errors visible to the caller; do not bypass
   core authorization or reimplement its decision logic.
4. **Separate audit ownership.** Let the core API audit core decisions such as
   refund approval or denial. For changes to the tool's own data, use its
   own `createAuditLog(store)` instance and audit store. Keep customer data,
   note bodies and other sensitive payloads out of audit before/after fields.
   Use `@acme/auth-guard` for access checks on team-owned routes and data;
   the core API still checks roles independently.
5. **Wire up the quality gate.** Add an app `tsconfig.json` and include it in
   the root `typecheck` script (which currently names only the refunds app).
   Add an app `vitest.config.ts` and its path/glob to the root
   `vitest.config.ts` `test.projects` (which currently has no team-app entry).
   Add any required app build to CI with the appropriate owner review: CI
   currently builds only the refunds dashboard. `pnpm lint` scans the new
   directory and rejects imports from `apps/**`, but cannot detect runtime
   paths to a core DB — review those separately. The coverage report still
   measures only `packages/*`.
6. **Test the contract and the migration.** Check authorized and no-role
   requests, `assignedTo=me`, error propagation (including core `403` and
   repeated-decision `409`), core audit records for core changes, and local
   audit records for local changes. When migrating, record every legacy
   screen/flow and known defect in `team-apps/<name>/MIGRATION.md`; add a
   regression test for each defect. Do not commit legacy tokens or data.
7. **Review and submit.** Run `pnpm install` to update the lockfile, then
   `pnpm lint && pnpm typecheck && pnpm test`. Run `pnpm test:ci` and raise
   `.github/test-baseline.json` to the exact passing count (section 4).
   Confirm the team-app PR does not change `apps/` or `packages/`; if a core
   API change is required, make it a separate platform-owned PR. `team-apps/`
   has no blanket CODEOWNER; `/apps/` requires platform review and `.github/`
   requires security review once the placeholder teams in CODEOWNERS are set
   up. The [refunds API reference](apps/refunds-dashboard/README.md#team-app-api-apiv1refunds)
   includes local curl examples, filters and review actions.
