import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");

// Content of a file that lives under team-apps/<name>/ and reaches into the
// refunds-dashboard app — exactly what the boundary rule exists to reject.
const violatingImport = readFileSync(
  path.join(here, "fixtures", "team-app-imports-apps.mjs"),
  "utf8",
);
const violatingRequire =
  'const schema = require("../../apps/refunds-dashboard/src/db/schema");\nmodule.exports = schema;\n';
const cleanImport =
  'import { createAuditLog, InMemoryAuditLogStore } from "@acme/audit-log";\nexport const auditLog = createAuditLog(new InMemoryAuditLogStore());\n';

const eslint = new ESLint({ cwd: repoRoot });

/** Lint `code` as if it were a file at repo-relative `filePath`. */
function lintAs(filePath: string, code: string) {
  return eslint.lintText(code, { filePath: path.join(repoRoot, filePath) });
}

function ruleErrors(results: ESLint.LintResult[], ruleId: string) {
  return results
    .flatMap((r) => r.messages)
    .filter((m) => m.ruleId === ruleId && m.severity === 2);
}

describe("team-apps boundary rule", () => {
  it("rejects an import from apps/** inside a team-app", async () => {
    const results = await lintAs("team-apps/some-tool/index.mjs", violatingImport);
    const errors = ruleErrors(results, "no-restricted-imports");

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toContain("published API");
  });

  it("rejects a require() of a core app module inside a team-app", async () => {
    const results = await lintAs("team-apps/some-tool/index.mjs", violatingRequire);

    expect(ruleErrors(results, "no-restricted-modules").length).toBeGreaterThan(0);
  });

  it("allows platform packages inside a team-app", async () => {
    const results = await lintAs("team-apps/some-tool/index.mjs", cleanImport);

    expect(results.flatMap((r) => r.messages)).toEqual([]);
  });

  it("does not flag the same import outside team-apps/", async () => {
    const results = await lintAs("apps/sandbox/index.mjs", violatingImport);

    expect(ruleErrors(results, "no-restricted-imports")).toEqual([]);
  });
});
