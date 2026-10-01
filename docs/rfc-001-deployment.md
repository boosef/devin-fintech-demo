# RFC-001: Per-app deployment ("one repo ≠ one deploy")

| | |
| --- | --- |
| **Status** | **RFC — proposed, not accepted.** Nothing in this document is implemented. No workflow, Dockerfile, environment or registry may be added until the repo owner answers [Decisions needed](#6-decisions-needed). |
| **Scope** | How deployable workspaces in `apps/*` and `team-apps/*` get built and deployed independently of each other. |
| **Out of scope** | Implementation; preview deploys per PR; production auth, storage and KMS (see [PLAYBOOK.md section 5](../PLAYBOOK.md#5-whats-explicitly-out-of-scope-for-this-poc)); a Dockerfile in the `create-team-app` template (follow-up, see [Dockerfile-per-app convention](#44-dockerfile-per-app-convention)). |

## 1. Problem

The repo holds several independently owned workspaces but has no deployment
at all: CI (`.github/workflows/quality-gate.yml`, `nightly-full.yml`) only
lints, typechecks, tests and builds. When deploys are added, a change to one
app must not redeploy, block or expose secrets to any other app. A change to
a shared package must redeploy exactly the apps that consume it.

## 2. What exists today (facts this RFC builds on)

Every item below can be checked in the repo at the time of writing.

- **Deployable workspaces.** One: `apps/refunds-dashboard` (`@acme/refunds-dashboard`),
  a Next.js app with `build: next build` and `start: next start`. It uses
  `better-sqlite3` (a native module, listed in `serverExternalPackages` in its
  `next.config.mjs`) and stores data in a SQLite file at `data/refunds.db`
  relative to its working directory (`src/db/client.ts`), applying Drizzle
  migrations from `drizzle/` whenever the database is opened. Its runtime
  configuration is `REFUNDS_ENCRYPTION_KEY` (server-only) and
  `MOCK_AUTH_ENABLED` (`apps/refunds-dashboard/.env.example`).
- **Libraries, never deployed.** `packages/audit-log` and `packages/auth-guard`
  ship raw TypeScript (`exports` → `./src/index.ts`) and are bundled into the
  apps that depend on them (`transpilePackages`).
- **Team apps.** `pnpm-workspace.yaml` includes `team-apps/*`, but no team app
  exists yet. `pnpm create-team-app <name>` (`scripts/create-team-app.mjs`)
  generates `@acme/team-<name>` from `scripts/create-team-app/templates/`
  with `lint`, `typecheck` and `test` scripts only — no `build`, `start` or
  Dockerfile.
- **Task graph.** Turborepo 2.11.3 (`turbo.json`): `build` depends on
  `^typecheck`, `^build` and `typecheck`, with outputs `dist/**` and
  `.next/**`. `globalDependencies` are `tsconfig.base.json`,
  `eslint.config.mjs`, `vitest.config.ts`, `pnpm-lock.yaml`, `.nvmrc` and
  `.github/workflows/**`.
- **The quality gate is deliberately unfiltered.** It runs
  `pnpm turbo run lint typecheck test build` over the whole graph, because
  `scripts/check-test-baselines.mjs` fails any package with tests but no
  `test-results.json`. AGENTS.md forbids adding `--filter` to that run. This
  RFC does not change that: change detection below only selects *what to
  deploy*, in a separate workflow that runs after the gate has passed.
- **Ownership.** `.github/CODEOWNERS` assigns `/.github/` and
  `/scripts/check-test-baselines.mjs` to security reviewers and `/apps/` to
  the platform team; `team-apps/` has no owner. Both teams are placeholders
  until a repo admin replaces them (README, "Manual repository admin steps").
- **Repository plan constraints.** The repository is private and owned by a
  personal account. Per GitHub's [deployments and environments
  reference](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments),
  environment secrets in private repos need GitHub Pro, Team or Enterprise,
  and **required reviewers in private repos need GitHub Enterprise** (on
  Free, Pro and Team they are public-repo only). The current plan is not
  visible from the repo; see decision 6.

## 3. Options

All three options share the cross-cutting design in section 4 (change
detection, environments, secrets, Dockerfile convention). They differ in
where the artifact runs and who operates it.

### (a) Container image per app on a managed container runtime (ECS Fargate, Cloud Run, Fly.io)

- **Independent deploys.** Each deployable workspace has its own
  `Dockerfile`, image repository and runtime service. The deploy job builds
  `<registry>/<app>:<git-sha>` once and deploys that digest; deploying one app
  updates only that app's service.
- **Environment model.** One service per app per environment
  (`refunds-dashboard-staging`, `refunds-dashboard-production`), each mapped
  to a GitHub Environment of the same name. The same image digest is promoted
  from staging to production; only runtime configuration differs.
- **Rollback.** Redeploy the previous digest: an earlier ECS task-definition
  revision, Cloud Run traffic shifted to an earlier revision, or `fly deploy`
  with the earlier image. Code rollback is fast; **schema rollback is not**:
  the dashboard applies Drizzle migrations on open, so a rolled-back image
  may meet a newer schema. Migrations must stay backwards compatible for one
  release (expand/contract).
- **Ops burden.** Moderate. The platform team owns the Dockerfile convention,
  registry, per-app runtime identities and secret-manager entries; the
  provider owns hosts, scaling and TLS.
- **Cost profile.** Pay per running container (vCPU/memory time) plus
  registry storage and egress. Cloud Run and Fly can scale idle services
  down; Fargate tasks bill while running. Each team app adds at least one
  small service per environment.
- **Fit with this repo.** Good. The SQLite file needs a persistent,
  single-writer volume, which constrains choice: Fly volumes (block storage
  attached to one machine) fit directly; ECS (EFS) and Cloud Run (network
  file mounts) are network filesystems, on which SQLite locking is not
  recommended. On those two, the dashboard needs Postgres first (already a
  listed production gap in its README).

### (b) Platform-native per-app deploys (Vercel / Netlify class)

- **Independent deploys.** One platform project per app with its root
  directory set to `apps/<name>` or `team-apps/<name>`. To keep GitHub
  Environments and turbo-based selection as the single source of truth, the
  platform's own Git auto-deploys are disabled and the deploy job pushes a
  prebuilt output with the platform CLI (for Vercel, `vercel build` then
  `vercel deploy --prebuilt`). Leaving Git auto-deploys on would bypass the
  production approval in section 4.2.
- **Environment model.** The platform's built-in contexts (Vercel:
  Production / Preview / Development; Netlify: deploy contexts) per project,
  each mapped to the matching GitHub Environment. Preview deploys per PR come
  free but are out of scope here.
- **Rollback.** Strongest of the three for code: promote or re-publish a
  previous immutable deployment from the dashboard or CLI. The schema caveat
  from (a) still applies once there is a real database.
- **Ops burden.** Lowest: no images, registry or runtime to operate.
- **Cost profile.** Per-seat plan plus usage (function invocations, duration,
  bandwidth). Cheap for low-traffic internal tools; per-seat pricing grows
  with the number of teams that need dashboard access.
- **Fit with this repo.** **Poor today.** Serverless functions have no
  persistent writable filesystem, so the dashboard's SQLite store cannot
  work; it needs a hosted database before its first deploy. `better-sqlite3`
  is a native module that would also have to match the function runtime.
  Team apps built as stateless API clients fit well.

### (c) Kubernetes + GitOps (EKS/GKE/AKS with Argo CD or Flux)

- **Independent deploys.** One `Deployment`/`Service`/`Ingress` per app in a
  namespace per app-environment (`refunds-dashboard-staging`, ...). CI builds
  and pushes the image, then opens or commits an image-tag bump to that app's
  overlay in a GitOps config location (Kustomize/Helm); Argo CD or Flux syncs
  only the changed app.
- **Environment model.** One overlay per environment per app; production
  promotion is a reviewed change to the production overlay. GitHub
  Environments still gate the CI job that writes the bump.
- **Rollback.** `git revert` of the tag bump (or an Argo CD rollback),
  synced automatically; same schema caveat as (a).
- **Ops burden.** Highest: cluster upgrades, node pools, ingress, cert
  management, Argo/Flux, External Secrets Operator, per-namespace RBAC and
  NetworkPolicies. Justified only with several services or an existing
  cluster to reuse.
- **Cost profile.** Managed control-plane fee on most providers plus
  always-on nodes, regardless of app count; platform-team time dominates.
  Marginal cost per extra app is low once the cluster exists.
- **Fit with this repo.** Works (SQLite on a `ReadWriteOnce` volume, one
  replica), but the burden is out of proportion for one core app and zero
  team apps.

### Summary

| | (a) Containers, managed runtime | (b) Platform-native | (c) Kubernetes + GitOps |
| --- | --- | --- | --- |
| Per-app independence | Service + image repo per app | Project per app | Namespace + overlay per app |
| Environments | Service per env ↔ GitHub Environment | Platform contexts ↔ GitHub Environment | Overlay/namespace per env ↔ GitHub Environment |
| Code rollback | Previous digest/revision | Promote previous deployment | Revert tag bump |
| Ops burden | Moderate | Low | High |
| Cost driver | Running containers | Seats + usage | Cluster + nodes + people |
| Dashboard as-is (SQLite) | Yes on Fly volumes; Postgres first on ECS/Cloud Run | No — needs hosted DB first | Yes, single replica |

Author's leaning (non-binding): (a), because it works with the dashboard's
current storage on at least one runtime, keeps one artifact (an image) for
core and team apps alike, and is the cheapest path to a proven staging
pipeline. (b) becomes attractive if the dashboard moves to a hosted database
and team apps stay stateless.

## 4. Cross-cutting design (applies to every option)

### 4.1 Detecting changed apps

A separate `deploy` workflow (never the quality gate) runs only after
`quality-gate` succeeds on a push to `main`. For each target environment it
computes the deploy set:

```bash
# BASE = the SHA last successfully deployed to this environment
#        (from the GitHub Deployments API); no prior deployment => deploy all
turbo ls --filter="...[$BASE]" --output=json
# keep only items whose path is apps/* or team-apps/* AND contains a Dockerfile
```

`...[$BASE]` selects packages changed since `BASE` plus all their dependents,
so a change to `packages/audit-log` selects the dashboard. Using the last
deployed SHA per environment instead of the push's `before` SHA means a
failed or skipped deploy is retried by the next push, and avoids the
all-zeros `before` on a branch's first push. The checkout needs full history
(`fetch-depth: 0`, as the gate already uses); turbo treats every package as
changed when the history is too shallow.

Selection observed with turbo 2.11.3 in a scratch worktree of this repo (one
commit, `turbo ls --filter='...[HEAD~1]'`):

| Changed | Selected |
| --- | --- |
| `apps/refunds-dashboard/src/**` or its `test-baseline.json` | `@acme/refunds-dashboard` |
| `packages/audit-log/src/**` | `@acme/audit-log`, `@acme/refunds-dashboard` |
| new `team-apps/foo` from `pnpm create-team-app foo` | `@acme/team-foo` |
| `tsconfig.base.json` or `.github/workflows/*.yml` (global dependencies) | every package |
| root `README.md`, `docs/**`, `scripts/**`, root `package.json` | nothing |
| a no-op (comment) edit to `pnpm-lock.yaml` | nothing |

Consequences: editing any workflow file, including the future `deploy.yml`,
redeploys every deployable app; deploy-relevant root files that are not
global dependencies (root `package.json`, and any future root file a
Dockerfile copies) select nothing and need a manual `workflow_dispatch` run.
Dependency bumps in the lockfile were not tested here; verify per-package
selection before relying on it.

Each `(app, environment)` pair becomes one matrix job with
`concurrency: deploy-<app>-<env>` (no cancel-in-progress), so two apps never
share a job and one app's deploys are serialized. A `workflow_dispatch`
input `app` + `ref` allows manual deploys and rollbacks of a single app.

### 4.2 GitHub Environments

- Two environments per deployable app: `<env-prefix><app>-staging` and
  `<env-prefix><app>-production` (naming in decision 3). The prefix keeps a
  team app named like a core app from ever mapping to the core app's
  environment, e.g. `core-refunds-dashboard-*` vs `team-refunds-dashboard-*`.
- Both restrict deployment branches to `main`, so a workflow running on a PR
  branch cannot reference them.
- Production environments require reviewers (platform team for core apps,
  decision 4 for team apps) with self-review prevented, and disallow admin
  bypass. On this private repository that requires GitHub Enterprise
  (decision 6).
- Staging deploys automatically after the gate; production deploys the
  *same image digest* that is live in staging, after approval.

### 4.3 Secrets model

- **No deploy or runtime secrets at repository or organization level.**
  Those are visible to every job in the repo, including team-app jobs.
  Everything app-specific lives in that app's GitHub Environment, which
  GitHub only exposes to jobs that reference it, and only after approval
  where reviewers are required.
- **Prefer OIDC over stored credentials.** The deploy job requests a GitHub
  OIDC token; the cloud trust policy for each app-environment role matches
  the token's subject `repo:boosef/devin-fintech-demo:environment:<env name>`.
  The GitHub Environment then holds only non-secret identifiers (role ARN,
  project, service name) and a team-app job cannot assume the core role.
- **Runtime secrets live in the platform's secret store, scoped per app.**
  `REFUNDS_ENCRYPTION_KEY` and any future database URL for the core app are
  readable only by the core app's runtime identity in that environment.
  `team-apps/*` never receive the core app's database credentials or
  encryption key, in CI or at runtime; they get only the core API's base URL
  (not a secret) and their own credentials, consistent with AGENTS.md
  ("never open or query a core app's database").
- **Images are environment-agnostic.** No secrets as build args and no
  environment-specific `NEXT_PUBLIC_*` values, so one digest can be promoted
  unchanged.
- **Who can change the wiring.** `deploy.yml` lives under `/.github/`, which
  is security-owned, so a team cannot change which environment its job
  references. A team's own code (Dockerfile, build) runs in its own job and
  can only reach that job's environment.
- `MOCK_AUTH_ENABLED` must not be `true` in production. With it off, every
  dashboard page and action is rejected (dashboard README), so production is
  unusable until real authentication exists (PLAYBOOK section 5).

### 4.4 Dockerfile-per-app convention

- An app opts into deployment by committing `<app dir>/Dockerfile`; no
  Dockerfile, no deploy. Core app Dockerfiles are platform-owned via
  `/apps/` in CODEOWNERS.
- Build context is the output of `turbo prune <package> --docker`, which
  writes a pruned workspace (`json/`, `full/`, pruned `pnpm-lock.yaml`)
  containing only the target and its workspace dependencies. Checked against
  this repo: pruning `@acme/refunds-dashboard` yields the dashboard,
  `audit-log` and `auth-guard`, but **not `tsconfig.base.json`**, which every
  workspace `tsconfig.json` extends; `turbo prune` omits
  `globalDependencies` files unless the `pruneIncludesGlobalFiles` future
  flag is set, so the Dockerfile or a `turbo.json` change must add it.
- Base image pinned to the Node major in `.nvmrc` (22) and to a libc that
  `better-sqlite3` supports (Debian-based images avoid musl rebuilds).
- Run `next start` on the built output. Next.js `output: "standalone"` would
  shrink images but is a `next.config.mjs` change, left to implementation.
- **Follow-up, out of scope for this RFC:** the `create-team-app` template
  (`scripts/create-team-app/templates/`) should add a Dockerfile, plus
  `build`/`start` scripts, so generated team apps are deployable by default.

### 4.5 Team apps use the same pipeline shape

Team apps get no bespoke workflows. The same `deploy.yml` matrix, the same
Dockerfile convention, the same registry layout (`<registry>/team-<name>`)
and the same environment pair (`team-<name>-staging`, plus
`team-<name>-production` if decision 4 allows) apply. Each team app has its
own environments, runtime identity and secrets; it reaches core data only
through the core app's published API, as today.

## 5. Migration path

1. **Decisions recorded** in this RFC (section 6) and the status changed to
   accepted.
2. **Admin prerequisites:** replace the CODEOWNERS placeholder teams; choose
   the GitHub plan/ownership needed for decision 6; create the registry,
   per-app-environment cloud roles with OIDC trust, and the staging GitHub
   Environments.
3. **Staging only, core app first:** a platform-owned PR adds
   `apps/refunds-dashboard/Dockerfile` and a security-reviewed PR adds
   `deploy.yml` targeting `*-staging` only. No production environment
   exists yet.
4. **Prove staging:** an app change deploys only the dashboard; a
   `packages/audit-log` change deploys the dashboard; a docs-only change
   deploys nothing; a rollback to the previous digest is rehearsed; secrets
   are confirmed absent from repository-level settings.
5. **Team apps on staging:** the generator follow-up (4.4) lands and the
   first team app deploys through the same matrix to `team-<name>-staging`.
6. **Production, after staging is proven** and only once the PLAYBOOK
   section 5 gaps that block real use (authentication, production storage
   and key management) are closed: create `*-production` environments with
   required reviewers and enable promotion of the staging digest.

## 6. Decisions needed

1. **Platform:** (a) managed containers — and which runtime (ECS Fargate,
   Cloud Run, Fly.io) — (b) Vercel/Netlify class, or (c) Kubernetes + GitOps.
   If (a) on ECS/Cloud Run or (b), is moving the dashboard off SQLite a
   prerequisite?
2. **Container registry** (if (a) or (c)): GHCR, ECR or Artifact Registry,
   with one repository per app so push rights can be scoped per app.
3. **Environment and domain naming:** confirm `core-<app>-<env>` /
   `team-<name>-<env>` for GitHub Environments and services, and choose a
   hostname pattern (for example `<app>.staging.<internal domain>` and
   `<app>.<internal domain>`).
4. **Team apps: production or staging-only?** If production, who are the
   required reviewers for a team app's production environment: the owning
   team, the platform team, or both?
5. **Rollback ownership:** who may trigger a rollback per app and
   environment (platform on-call for core apps; owning team for team apps?),
   and who owns schema compatibility for apps that migrate on startup.
6. **GitHub plan / repository ownership:** required reviewers on a private
   repository need GitHub Enterprise. Move the repository to an
   Enterprise-plan organization, or accept a different production approval
   mechanism?
