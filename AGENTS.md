# AGENTS.md

Rules for any coding agent working in this repository. Read PLAYBOOK.md for the
step-by-step procedures.

## Platform packages are mandatory

- Use `@acme/audit-log` for every state-changing action. Never write audit
  logging inside an app.
- Use `@acme/auth-guard` for every access check. Never read role headers
  (`x-mock-role`, `x-mock-user-id`) directly in an app.

## Tests and the quality gate

- Never delete, skip (`it.skip`, `describe.skip`, `it.todo`) or weaken a test to
  make CI pass. Fix the code, or stop and explain the problem in the PR.
- The baseline is a ratchet: `minPassedTests` in `.github/test-baseline.json`
  must equal the number of passing tests exactly, and may only go up. If your
  PR adds tests, raise it in the same PR to the new passing count — leaving it
  stale fails the build, exactly like deleting a test does.
- Never lower `minPassedTests`, and never set it below the value on the PR's
  base branch; CI checks both.
- Skipped and todo tests fail the build by design: a skipped test is a removed
  test.

## Scope

- Never edit files under `.github/` or `packages/` unless the task explicitly
  asks for it. Those paths are code-owned and require security review.
- New apps go in `apps/<name>` and follow PLAYBOOK.md section 1.
- Every state-changing action in an app must be audited, and every route must be
  role-checked.

## Team apps

- `apps/` is platform-owned: a PR that builds or migrates an employee tool must
  never change it. Only the platform team touches core apps.
- Team apps live in `team-apps/<name>/`, own only their own data, and reach
  core data only through a core app's published API (for refunds:
  `/api/v1/refunds`, documented in `apps/refunds-dashboard/README.md`).
- A team app may not import from `apps/**` and may not open or query a core
  app's database — `pnpm lint` enforces this boundary with an error.

## Before opening a PR

Run, from the repo root:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

All three must pass with zero errors.
