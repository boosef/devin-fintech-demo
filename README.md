# devin-fintech-demo — internal tools

Shared audit logging and role checks for internal fintech tools. Platform-owned
core apps in `apps/` expose published APIs for employee-built tools in
`team-apps/`. The [refunds review dashboard](apps/refunds-dashboard/README.md)
is the first core app and [its versioned refunds API](apps/refunds-dashboard/README.md#team-app-api-apiv1refunds)
is the first published contract. A KYC checker and a feature-flag enabler are
**planned**; neither is implemented here yet.

This is a proof of concept with synthetic data, not a production deployment.
See [PLAYBOOK.md](PLAYBOOK.md#5-whats-explicitly-out-of-scope-for-this-poc) and
the [dashboard's production gaps](apps/refunds-dashboard/README.md#out-of-scope).

## Layout

```
packages/audit-log       @acme/audit-log          append-only audit records
packages/auth-guard      @acme/auth-guard         mock role-based access checks
apps/refunds-dashboard   @acme/refunds-dashboard  refunds review UI and API
team-apps/*              configured workspace for team-owned tools
scripts/                 CI helper scripts
.github/                 quality-gate workflow, CODEOWNERS, test baseline
```

## Build a team tool or add a core use case

Team tools call a core app's **versioned API** from their server, keep their
own data and audit their own local changes. They do not import core app code
or query its database. For refunds, the published contract is
`GET /api/v1/refunds` and `POST /api/v1/refunds/:id/approve|deny`; the
dashboard's older unversioned routes are for its own UI. See the
[team-app workflow](PLAYBOOK.md#6-building-or-migrating-a-team-app) for setup,
identity forwarding, tests and migration checks, and the
[refunds API reference](apps/refunds-dashboard/README.md#team-app-api-apiv1refunds)
for request/response details.

If a team needs data or an action the published contract does not provide,
request a platform-owned API change first. The [core-app workflow](PLAYBOOK.md#1-adding-a-platform-owned-core-app)
covers new apps and API design; [AGENTS.md](AGENTS.md) defines the ownership
boundary for both people and agents.

## Refunds dashboard at a glance

The [dashboard](apps/refunds-dashboard/README.md) lets a reviewer or admin:

- Filter synthetic refund requests by status and requested date.
- Approve with an optional note or deny with a required reason; a request can
  leave pending only once.
- Inspect an audit trail for each decision. The UI and API share role checks and
  service logic; customer IDs and amounts are encrypted in the local SQLite DB.

![Refunds dashboard showing pending synthetic requests, review actions and status filters](apps/refunds-dashboard/screenshot.png)

In development, use **Viewing as** to switch between reviewer, admin and no
role. This is mock auth, not a sign-in system. See the [dashboard setup and API
guide](apps/refunds-dashboard/README.md#setup) for the key, seed data and API
examples.

## Getting started

Use Node 22 (`.nvmrc`; install it with `nvm install` if needed). Corepack uses
the pinned `pnpm@12.6.0` in `package.json`: an older global pnpm may reject the
lockfile as incompatible.

```bash
nvm use
corepack enable
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test
```

To run the app, [set its encryption key and seed the local
database](apps/refunds-dashboard/README.md#setup), then run
`pnpm --filter @acme/refunds-dashboard dev`. Useful scripts:
`pnpm test:ci` (coverage + `test-results.json`),
`pnpm --filter @acme/audit-log test` (single package). `pnpm test` runs each
workspace package's suite through Turborepo; the CI helper tests in `scripts/`
(not a workspace package) run only in the root `pnpm test:ci` run, which is
also the run the baseline counts. **Coverage measures only `packages/*`**, not
the app or scripts. New team apps are wired up by hand; see the
[playbook](PLAYBOOK.md#6-building-or-migrating-a-team-app).

## Build caching

`pnpm lint`, `pnpm typecheck` and `pnpm test` run `turbo run <task>`, which
runs each workspace package's script of the same name and caches the result
in `.turbo/` (gitignored). Rerunning with unchanged inputs replays the cached
logs (`FULL TURBO`). A package's hash covers its own tracked files, the hashes
of the dependency tasks in `turbo.json` (`test`, `build` and `typecheck` depend
on `^typecheck`, so editing `packages/audit-log` reruns the dashboard's
typecheck, test and build), and the `globalDependencies`: `tsconfig.base.json`,
`eslint.config.mjs`, `vitest.config.ts`, `pnpm-lock.yaml`, `.nvmrc` and
`.github/workflows/**`. Changing any of those invalidates every task. Root
files (`scripts/`, root configs) and all of `team-apps/` are linted by the
`//#lint:root` task, so the team-app import boundary holds even for a team app
without a `lint` script. CI
restores `.turbo/` with `actions/cache` but still runs every task; there is no
affected-package filtering, so the test-count ratchet always sees the full
suite. Use `pnpm turbo run <task> --force` to bypass the cache.

## Decisions

- **pnpm workspaces with Turborepo for task caching.** Turborepo only
  orchestrates and caches `lint`, `typecheck`, `test` and `build`; pnpm still
  owns installs and workspace linking. See [Build caching](#build-caching).
- **No build step for shared packages.** Each package's `exports` and `types`
  point at `./src/index.ts`; apps depend on them with `"workspace:*"`. A Next.js
  app must therefore list `@acme/audit-log` and `@acme/auth-guard` in
  `transpilePackages` in its `next.config.mjs`. CI builds the refunds dashboard.
- **TypeScript `strict: true` everywhere**, Vitest with the v8 coverage provider
  from a single root `vitest.config.ts` (`test.projects`), ESLint flat config
  (`eslint.config.mjs`) with typescript-eslint `recommended`.

## Quality gate

Every PR (against any branch) runs `pnpm turbo run lint typecheck test build`
across all workspace packages, then the root `pnpm test:ci` run and a
**test-count baseline ratchet**. The ratchet fails if the passing-test
count does not exactly match `minPassedTests` in `.github/test-baseline.json`,
if that value is below the one on the base branch, or if any test is skipped,
todo or failing. See [PLAYBOOK.md](PLAYBOOK.md#4-what-the-quality-gate-checks-and-how-to-update-the-test-baseline)
and [AGENTS.md](AGENTS.md).

## Manual repository admin steps

1. Replace the placeholder team `@acme-org/security-reviewers` in
   `.github/CODEOWNERS` with a real GitHub team that has write access to this
   repository. Until then GitHub reports an "unknown owner" error for it.
2. In branch protection for the default branch, turn on **Require review from
   Code Owners** and make the **quality-gate** check **required**.
