import { describe, expect, it } from "vitest";

import {
  evaluateWorkspaces,
  listBaseBaselineDirs,
  parseWorkspaceGlobs,
  readBaseMinPassedTests,
} from "../check-test-baselines.mjs";

function counts(overrides = {}) {
  return { passed: 13, failed: 0, pending: 0, todo: 0, ...overrides };
}

function ws(dir, overrides = {}) {
  return { dir, hasTests: true, counts: counts(), minPassedTests: 13, baseMinPassedTests: 13, ...overrides };
}

function evaluate(workspaces, options = {}) {
  return evaluateWorkspaces({ workspaces, ...options }).failures;
}

describe("evaluateWorkspaces: per-package ratchet", () => {
  it("passes when each package's passed count equals its baseline", () => {
    expect(evaluate([ws("packages/a"), ws("apps/b")])).toEqual([]);
  });

  it("fails when more tests pass than the package baseline records", () => {
    expect(evaluate([ws("packages/a", { counts: counts({ passed: 14 }) })])).toEqual([
      "packages/a: Passed 14 tests but baseline is 13. Raise minPassedTests to 14 in packages/a/test-baseline.json in this PR.",
    ]);
  });

  it("fails when fewer tests pass than the package baseline records", () => {
    const failures = evaluate([ws("packages/a", { counts: counts({ passed: 12 }) })]);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("packages/a: passed test count regressed: 12 passed");
  });

  it("fails when a package baseline is lowered below the base branch", () => {
    const lowered = ws("team-apps/x", { counts: counts({ passed: 12 }), minPassedTests: 12 });

    expect(evaluate([lowered])).toEqual([
      "team-apps/x: baseline was lowered: minPassedTests is 12 but the base branch requires 13. The ratchet only goes up.",
    ]);
  });

  it("fails on skipped, todo or failed tests in a package", () => {
    const failures = evaluate([ws("packages/a", { counts: counts({ passed: 12, pending: 1 }) })]);

    expect(failures).toContain(
      "packages/a: skipped or todo tests present: 1 skipped, 0 todo. A skipped test counts as a removed test.",
    );
  });

  it("fails when a package has tests but no baseline file", () => {
    expect(evaluate([ws("team-apps/x", { minPassedTests: null, baseMinPassedTests: 0 })])).toEqual([
      'team-apps/x: has tests but no team-apps/x/test-baseline.json. Add { "minPassedTests": N } with its passing count.',
    ]);
  });

  it("fails when a baseline on the base branch is deleted without a removed-workspaces entry", () => {
    const emptied = ws("team-apps/x", { hasTests: false, counts: null, minPassedTests: null });
    const deleted = (workspaces) => evaluate(workspaces, { baseBaselineDirs: ["team-apps/x"] });

    // Package dir still exists, and package dir removed entirely.
    for (const failures of [deleted([emptied]), deleted([])]) {
      expect(failures).toEqual([
        'team-apps/x: team-apps/x/test-baseline.json exists on the base branch but was deleted. List "team-apps/x" in .github/removed-workspaces.json to remove a workspace.',
      ]);
    }
  });

  it("passes a deleted baseline when the package is listed in removed-workspaces.json", () => {
    const emptied = ws("team-apps/x", { hasTests: false, counts: null, minPassedTests: null });
    const options = { baseBaselineDirs: ["team-apps/x"], removed: ["team-apps/x"] };

    expect(evaluate([emptied], options)).toEqual([]);
    expect(evaluate([], options)).toEqual([]);
  });

  it("checks each package independently and sums the totals", () => {
    const result = evaluateWorkspaces({
      workspaces: [
        ws("packages/a", { counts: counts({ passed: 8 }), minPassedTests: 8, baseMinPassedTests: 8 }),
        ws("apps/b", { counts: counts({ passed: 32 }), minPassedTests: 30, baseMinPassedTests: 30 }),
        ws("scripts", { counts: counts({ passed: 5 }), minPassedTests: 6, baseMinPassedTests: 6 }),
      ],
    });

    expect(result.totals).toEqual({ passed: 45, minPassedTests: 44 });
    // A surplus in one package cannot cover a deficit in another.
    expect(result.failures.map((failure) => failure.split(":")[0])).toEqual(["apps/b", "scripts"]);
  });
});

describe("readBaseMinPassedTests", () => {
  it("treats a package baseline missing on the base branch as 0", () => {
    const missing = () => {
      throw new Error("fatal: path 'team-apps/x/test-baseline.json' does not exist");
    };

    expect(readBaseMinPassedTests("origin/main", "team-apps/x/test-baseline.json", missing)).toBe(0);
    expect(evaluate([ws("team-apps/x", { baseMinPassedTests: 0 })])).toEqual([]);
  });

  it("reads the package baseline committed on the base branch", () => {
    const shown = [];
    const show = (ref, file) => {
      shown.push(`${ref}:${file}`);
      return JSON.stringify({ minPassedTests: 13 });
    };

    expect(readBaseMinPassedTests("origin/main", "packages/a/test-baseline.json", show)).toBe(13);
    expect(shown).toEqual(["origin/main:packages/a/test-baseline.json"]);
  });
});

describe("workspace discovery", () => {
  it("reads pnpm-workspace.yaml globs plus scripts and matches base-branch baselines", () => {
    const yaml = "packages:\n  - 'packages/*'\n  - \"apps/*\"\n  - team-apps/*\n\nallowBuilds:\n  esbuild: true\n";
    const globs = parseWorkspaceGlobs(yaml);
    const files = ["packages/a/test-baseline.json", "packages/a/src/x/test-baseline.json", "scripts/test-baseline.json", ".github/test-baseline.json"];

    expect(globs).toEqual(["packages/*", "apps/*", "team-apps/*", "scripts"]);
    expect(listBaseBaselineDirs("origin/main", globs, () => files)).toEqual(["packages/a", "scripts"]);
  });
});
