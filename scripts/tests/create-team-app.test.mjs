import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, relative } from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, createTeamApp } from "../create-team-app.mjs";

const NAME = "smoke";

/**
 * Builds a repo-shaped sandbox outside the repo: root configs and node_modules
 * linked from the repo, the generated app at team-apps/<name>, and its
 * workspace deps linked the way `pnpm install` would.
 */
function generateInSandbox() {
  const root = mkdtempSync(join(tmpdir(), "create-team-app-"));
  for (const file of ["node_modules", "tsconfig.base.json", "eslint.config.mjs"]) {
    symlinkSync(join(REPO_ROOT, file), join(root, file));
  }
  const appDir = createTeamApp(NAME, join(root, "team-apps", NAME));
  mkdirSync(join(appDir, "node_modules", "@acme"), { recursive: true });
  for (const pkg of ["audit-log", "auth-guard"]) {
    symlinkSync(join(REPO_ROOT, "packages", pkg), join(appDir, "node_modules", "@acme", pkg));
  }
  return { root, appDir };
}

function runScript(appDir, script) {
  const command = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")).scripts[script];
  const env = { ...process.env, NO_COLOR: "1", PATH: `${join(REPO_ROOT, "node_modules", ".bin")}${delimiter}${process.env.PATH}` };
  delete env.FORCE_COLOR;
  const result = spawnSync(command, { cwd: appDir, encoding: "utf8", env, shell: true });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("create-team-app", () => {
  it("generates a team app that passes its lint, typecheck and test scripts and keeps the apps/** boundary", async () => {
    const { root, appDir } = generateInSandbox();
    try {
      for (const script of ["lint", "typecheck", "test"]) {
        const { status, output } = runScript(appDir, script);
        expect(status, `${script}:\n${output}`).toBe(0);
      }
      expect(JSON.parse(readFileSync(join(appDir, "test-results.json"), "utf8")).numPassedTests).toBe(1);

      // The lint script must really have linted the app under the team-apps/ config.
      const linted = await new ESLint({ cwd: appDir }).lintFiles(["."]);
      expect(linted.map((r) => relative(appDir, r.filePath)).sort()).toEqual([
        "src/index.ts",
        "tests/example.test.ts",
        "vitest.config.ts",
      ]);

      const source = readFileSync(join(appDir, "src", "index.ts"), "utf8");
      const violating = `import { refundRequests } from "../../../apps/refunds-dashboard/src/db/schema";\n${source}\nexport { refundRequests };\n`;
      const [result] = await new ESLint({ cwd: REPO_ROOT }).lintText(violating, {
        filePath: join(REPO_ROOT, "team-apps", NAME, "src", "index.ts"),
      });
      const boundary = result?.messages.filter((m) => m.ruleId === "no-restricted-imports" && m.severity === 2) ?? [];
      expect(boundary).toHaveLength(1);
      expect(boundary[0]?.message).toContain("published API");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("rejects a name whose team-apps/<name> directory git ignores", () => {
    const root = mkdtempSync(join(tmpdir(), "create-team-app-"));
    try {
      const target = join(root, "team-apps", "coverage");
      expect(() => createTeamApp("coverage", target)).toThrow("ignored by .gitignore");
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
