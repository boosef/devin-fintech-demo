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
       "lint": "eslint .",
       "typecheck": "tsc --noEmit",
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

4. Add an app `tsconfig.json` that extends `../../tsconfig.base.json` and the
   `lint`, `typecheck` and `test` scripts above (plus `build` if the app has
   one). The root scripts and CI run `turbo run <task>`, which only checks
   packages that define the script. Add a `vitest.config.ts` in the app, make
   its `test` script write `test-results.json` (section 4) and commit its
   `test-baseline.json` so its tests count towards the quality gate.
5. Non-negotiable rules: **every state-changing action is audited** through
   `@acme/audit-log`, and **every route is role-checked** through
   `@acme/auth-guard`. No app-local audit tables and no app-local header
   parsing.
6. Run `pnpm install`, then `pnpm lint && pnpm typecheck && pnpm test` before
   opening a PR, and raise the app's `minPassedTests` (section 4) for the tests
   you added.

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
2. `pnpm turbo run lint typecheck test build` — every workspace package's
   `lint` (ESLint flat config), `typecheck` (`tsc --noEmit`, `strict: true`),
   `test` and `build` scripts, plus `//#lint:root` for `scripts/`, `team-apps/` and
   root configs. All tasks run on every PR (no affected filtering); `.turbo/` is
   restored from `actions/cache` so unchanged packages replay cached results.
3. `pnpm test:ci` — `turbo run test` (cached; each package's `test` script is
   `vitest run --reporter=default --reporter=json --outputFile=test-results.json`),
   then the `scripts` Vitest project (not a workspace package) writing
   `scripts/test-results.json`, then the baseline guard with no base-branch floor.
4. **Test-count baseline guard** — `node scripts/check-test-baselines.mjs` again,
   with `BASE_REF` set so the base-branch rules apply.

Coverage is not collected in CI; `pnpm vitest run --coverage` reports it for
`packages/*/src/**/*.ts` locally.

The guard checks every workspace dir from the `pnpm-workspace.yaml` globs plus
`scripts`, skipping dirs with no `test` script and no `*.test.*` files. Each
remaining dir needs a `test-baseline.json` (`{ "minPassedTests": N }`) next to
its `test-results.json`, and each baseline is its own **ratchet**: it must equal
that package's passing count exactly, and may only ever go up. Failures name the
package path. It fails if:

- `numPassedTests > minPassedTests` — you added tests but left the baseline
  stale, so a later PR could delete them and still pass. Message:
  `<dir>: Passed N tests but baseline is M. Raise minPassedTests to N in
  <dir>/test-baseline.json in this PR.`;
- `numPassedTests < minPassedTests` — tests were deleted, or stopped passing;
- `minPassedTests` is lower than the value on the PR's base branch (read in CI
  with `git show origin/$GITHUB_BASE_REF:<dir>/test-baseline.json`; a baseline
  that does not exist there yet counts as `0`) — the ratchet was filed down;
- `numPendingTests > 0` or `numTodoTests > 0` — a skipped or todo test counts as
  a removed test, which is why skipping fails the build;
- `numFailedTests > 0`;
- a package has tests but no `test-baseline.json`; or
- a baseline that exists on the base branch was deleted (with or without its
  package dir) and the package is not listed in `.github/removed-workspaces.json`
  (`{ "removed": ["team-apps/x"] }`).

It exists to stop the failure mode where a failing test is "fixed" by deleting
or skipping it instead of fixing the bug — and, with the exact-match and
base-branch rules, to stop the baseline going stale so that deletion becomes
invisible later.

**Raising the baseline:** any PR that adds tests to a package must run
`pnpm test:ci` locally and set that package's `minPassedTests` to the exact
passing count the guard reports **in the same PR** — this is not optional, the
build fails without it. Edit only the baselines of packages you changed; never
lower one. Baselines are reviewed by their package's owners: teams own
`team-apps/*`, the platform team owns `apps/*`, and the security reviewers own
the `packages/*` baselines, the checker and `.github/removed-workspaces.json`
(removing a workspace's baseline needs security review).

The guard's own logic is unit-tested in `scripts/tests/`, which runs as the
`scripts` Vitest project with its own `scripts/test-baseline.json`.

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
- **Workspace generator**: nothing scaffolds a new app or team app yet, so
  its `tsconfig.json`, `lint`/`typecheck`/`test`/`build` scripts and
  `test-baseline.json` are added by hand (sections 1 and 6).
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
5. **Wire up the quality gate.** This is manual until a workspace generator
   lands. Add an app `tsconfig.json` extending `../../tsconfig.base.json` and
   `"lint": "eslint ."`, `"typecheck": "tsc --noEmit"`,
   `"test": "vitest run --reporter=default --reporter=json --outputFile=test-results.json"`
   (and `build`, if any) to its `package.json`; Turborepo then runs them in
   `pnpm lint`/`typecheck`/`test` and CI. Add an app `vitest.config.ts` and
   `team-apps/<name>/test-baseline.json` — your team owns that file.
   `pnpm lint` rejects imports from `apps/**` in the new directory, but cannot
   detect runtime paths to a core DB — review those separately. The coverage
   report still measures only `packages/*`.
6. **Test the contract and the migration.** Check authorized and no-role
   requests, `assignedTo=me`, error propagation (including core `403` and
   repeated-decision `409`), core audit records for core changes, and local
   audit records for local changes. When migrating, record every legacy
   screen/flow and known defect in `team-apps/<name>/MIGRATION.md`; add a
   regression test for each defect. Do not commit legacy tokens or data.
7. **Review and submit.** Run `pnpm install` to update the lockfile, then
   `pnpm lint && pnpm typecheck && pnpm test`. Run `pnpm test:ci` and set
   `team-apps/<name>/test-baseline.json` to the exact passing count (section 4).
   Confirm the team-app PR does not change `apps/` or `packages/`; if a core
   API change is required, make it a separate platform-owned PR. `team-apps/`
   has no blanket CODEOWNER; `/apps/` requires platform review and `.github/`
   requires security review once the placeholder teams in CODEOWNERS are set
   up. The [refunds API reference](apps/refunds-dashboard/README.md#team-app-api-apiv1refunds)
   includes local curl examples, filters and review actions.
