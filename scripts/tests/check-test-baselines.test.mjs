import { describe, expect, it } from "vitest";

import {
  evaluateWorkspaces,
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
