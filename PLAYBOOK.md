# PLAYBOOK

How to build on the shared platform layer in this monorepo.

## 1. Adding a new internal app

1. Create the app under `apps/<name>` (e.g. `apps/refunds-dashboard`). Nothing
   else in the repo needs to change: `pnpm-workspace.yaml` already includes
   `apps/*`.
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

4. Extend `tsconfig.base.json`'s `include` (or add an app `tsconfig.json` that
   extends it) so `pnpm typecheck` covers the new app, and add a
   `vitest.config.ts` in the app so it is picked up by the root
   `test.projects: ["packages/*", "apps/*"]` glob when you add `apps/*` there.
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
4. `pnpm test:ci` — Vitest with v8 coverage, writing `test-results.json`.
5. **Test-count baseline guard** — `node scripts/check-test-baseline.mjs`.

The guard reads `test-results.json` and `.github/test-baseline.json`
(`{ "minPassedTests": N }`) and fails if:

- `numPassedTests < minPassedTests` — tests were deleted, or stopped passing;
- `numPendingTests > 0` or `numTodoTests > 0` — a skipped or todo test counts as
  a removed test, which is why skipping fails the build; or
- `numFailedTests > 0`.

It exists to stop the failure mode where a failing test is "fixed" by deleting
or skipping it instead of fixing the bug.

**Raising the baseline:** if your PR legitimately adds tests, run `pnpm test:ci`
locally, read the new passing count, and set `minPassedTests` to that exact
number in `.github/test-baseline.json` **in the same PR**. Never lower it.
`.github/**` is code-owned, so any change to the baseline — including lowering
it — requires review from the security reviewers team.

## 5. What's explicitly out of scope for this POC

- **Real SSO**: no JWT or session validation, no Entra ID/OIDC integration, no
  IdP group-to-role mapping, no token expiry or revocation. Auth is mock headers
  behind an env flag.
- **Persistent audit storage**: no database, no append-only DB grants, no
  retention policy, no tamper evidence (e.g. hash chaining), no export to a
  SIEM. The store is in-process and dies with the process.
- **Spend/cost governance**: no per-session or per-team ACU budgets, no
  iteration caps, no alerts on agent spend.
- **Agent identity layer**: agents do not get their own scoped, revocable
  credentials; `actorType` and `onBehalfOf` are recorded as claims but are not
  verified.
- **Guardrail/quality-gate depth**: no risk scoring or auto-merge tiers, no
  write-scope enforcement on agent PRs, no SAST or dependency scanning, no
  secret scanning beyond GitHub defaults.
