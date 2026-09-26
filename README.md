# devin-fintech-demo — internal-tools platform layer

Shared, reusable infrastructure for a monorepo of internal fintech tools. Apps
(a refunds dashboard, a KYC checker, a feature-flag enabler) import these
packages rather than reimplementing audit logging or access control.

This is a proof of concept for a demo. It works and it is tested, but it is not
production-grade — see PLAYBOOK.md section 5 for the explicit out-of-scope list.

## Layout

```
packages/audit-log    @acme/audit-log   append-only audit records
packages/auth-guard   @acme/auth-guard  mock role-based access checks
apps/                 internal apps (empty for now)
scripts/              CI helper scripts
.github/              quality-gate workflow, CODEOWNERS, test baseline
```

## Getting started

```bash
nvm use            # Node 22 (see .nvmrc); engines requires >=22
pnpm install
pnpm lint && pnpm typecheck && pnpm test
```

Useful scripts: `pnpm test:ci` (coverage + `test-results.json`),
`pnpm --filter @acme/audit-log test` (single package).

## Decisions

- **pnpm workspaces, not Turborepo.** The POC has ~2-4 packages, and
  Turborepo's build-caching value only shows up at higher package counts.
  *Revisit if we exceed ~10 packages.*
- **No build step.** Each package's `exports` and `types` point at
  `./src/index.ts`; apps depend on them with `"workspace:*"`. A Next.js app must
  therefore list `@acme/audit-log` and `@acme/auth-guard` in
  `transpilePackages` in its `next.config.mjs`.
- **TypeScript `strict: true` everywhere**, Vitest with the v8 coverage provider
  from a single root `vitest.config.ts` (`test.projects`), ESLint flat config
  (`eslint.config.mjs`) with typescript-eslint `recommended`.

## Quality gate

Every PR (against any branch) runs lint, typecheck, tests, and a **test-count
baseline ratchet** that fails if the passing-test count does not exactly match
`minPassedTests` in `.github/test-baseline.json`, if that value is below the one
on the base branch, or if any test is skipped, todo or failing. See
PLAYBOOK.md section 4 and AGENTS.md.

## Manual admin steps this PR cannot do itself

1. Replace the placeholder team `@acme-org/security-reviewers` in
   `.github/CODEOWNERS` with a real GitHub team that has write access to this
   repository. Until then GitHub reports an "unknown owner" error for it.
2. In branch protection for the default branch, turn on **Require review from
   Code Owners** and make the **quality-gate** check **required**.
