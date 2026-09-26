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
- Never lower `minPassedTests` in `.github/test-baseline.json`. If a PR
  legitimately adds tests, raise it in the same PR to the new passing count.
- Skipped and todo tests fail the build by design: a skipped test is a removed
  test.

## Scope

- Never edit files under `.github/` or `packages/` unless the task explicitly
  asks for it. Those paths are code-owned and require security review.
- New apps go in `apps/<name>` and follow PLAYBOOK.md section 1.
- Every state-changing action in an app must be audited, and every route must be
  role-checked.

## Before opening a PR

Run, from the repo root:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

All three must pass with zero errors.
