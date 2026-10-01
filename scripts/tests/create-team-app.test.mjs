import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { REPO_ROOT, createTeamApp } from "../create-team-app.mjs";

const bin = (name) => join(REPO_ROOT, "node_modules", ".bin", name);

function run(command, args, cwd = REPO_ROOT) {
  const env = { ...process.env, NO_COLOR: "1" };
  delete env.FORCE_COLOR;
  const result = spawnSync(bin(command), args, { cwd, encoding: "utf8", env });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Removes smoke dirs left by killed runs; they would otherwise count as workspaces. */
function removeStaleSmokeDirs(teamApps) {
  if (!existsSync(teamApps)) return;
  for (const entry of readdirSync(teamApps)) {
    const pid = Number(entry.match(/^\.smoke-(\d+)$/)?.[1]);
    if (pid && !isRunning(pid)) rmSync(join(teamApps, entry), { recursive: true, force: true });
  }
}

describe("create-team-app", () => {
  it("generates a team app that passes lint, typecheck and test and keeps the apps/** boundary", () => {
    // Under team-apps/ so the eslint boundary rule and vitest discovery apply.
    const teamApps = join(REPO_ROOT, "team-apps");
    const dir = join(teamApps, `.smoke-${process.pid}`);
    removeStaleSmokeDirs(teamApps);
    try {
      createTeamApp(`smoke-${process.pid}`, dir);
      // Stand-in for `pnpm install` linking the workspace dependencies.
      mkdirSync(join(dir, "node_modules", "@acme"), { recursive: true });
      for (const pkg of ["audit-log", "auth-guard"]) {
        symlinkSync(join(REPO_ROOT, "packages", pkg), join(dir, "node_modules", "@acme", pkg));
      }

      expect(run("eslint", [dir])).toMatchObject({ status: 0 });
      expect(run("tsc", ["-p", dir])).toMatchObject({ status: 0 });
      const tests = run("vitest", ["run"], dir);
      expect(tests.status, tests.output).toBe(0);
      expect(tests.output).toMatch(/Tests\s+1 passed/);

      writeFileSync(
        join(dir, "src", "core-internals.ts"),
        'export { refundRequests } from "../../../apps/refunds-dashboard/src/db/schema";\n',
      );
      const lint = run("eslint", [dir]);
      expect(lint.status).not.toBe(0);
      expect(lint.output).toContain("published API");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
