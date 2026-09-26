# PLAYBOOK

How to build on the shared platform layer in this monorepo.

## 1. Adding a new internal app

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
