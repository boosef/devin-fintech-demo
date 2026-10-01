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
- New platform-owned core apps go in `apps/<name>` and follow PLAYBOOK.md
  section 1. Team tools go in `team-apps/<name>` and follow section 6.
- All routes enforce roles through `@acme/auth-guard`. Core apps audit their
  own state changes; team apps audit their own state changes, while a core
  API audits decisions it owns.

## Team apps

- `apps/` is platform-owned: a PR that builds or migrates an employee tool must
  never change it. Only the platform team touches core apps.
- Team apps live in `team-apps/<name>/`, own only their own data, and reach
  core data only through a core app's published API (for refunds:
  `/api/v1/refunds`, documented in `apps/refunds-dashboard/README.md`).
- A team app may not import from `apps/**` or open or query a core app's
  database. `pnpm lint` rejects forbidden imports; database access must also
  be checked during review because lint does not inspect runtime DB paths.
- API gaps require a separate platform-owned change under `apps/`: add a
  versioned contract, service checks, tests and documentation before a team
  app relies on it. Never extend a team tool by reaching into core internals.

## Before opening a PR

Run, from the repo root:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

All three must pass with zero errors. Each runs through Turborepo
(`turbo run <task>`) across every workspace package, so a new package or app
is only checked once its `package.json` defines `lint`, `typecheck` and `test`
scripts (and `build` if it has one). That wiring is manual; see PLAYBOOK.md
section 6. `pnpm test` does not run the `scripts/` tests; run `pnpm test:ci`
for the full count that the baseline guard checks.
