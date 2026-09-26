import { describe, expect, it } from "vitest";

import { evaluateBaseline, readBaseMinPassedTests } from "../check-test-baseline.mjs";

function counts(overrides = {}) {
  return { passed: 13, failed: 0, pending: 0, todo: 0, ...overrides };
}

describe("evaluateBaseline", () => {
  it("passes when the passed count equals the baseline", () => {
    expect(
      evaluateBaseline({ counts: counts(), minPassedTests: 13, baseMinPassedTests: 13 }),
    ).toEqual([]);
  });

  it("fails when more tests pass than the baseline records", () => {
    const failures = evaluateBaseline({
      counts: counts({ passed: 14 }),
      minPassedTests: 13,
      baseMinPassedTests: 13,
    });

    expect(failures).toEqual([
      "Passed 14 tests but baseline is 13. Raise minPassedTests to 14 in .github/test-baseline.json in this PR.",
    ]);
  });

  it("fails when fewer tests pass than the baseline records", () => {
    const failures = evaluateBaseline({
      counts: counts({ passed: 12 }),
      minPassedTests: 13,
      baseMinPassedTests: 13,
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("passed test count regressed: 12 passed");
  });

  it("fails when the baseline is lowered below the base branch", () => {
    const failures = evaluateBaseline({
      counts: counts({ passed: 12 }),
      minPassedTests: 12,
      baseMinPassedTests: 13,
    });

    expect(failures).toEqual([
      "baseline was lowered: minPassedTests is 12 but the base branch requires 13. The ratchet only goes up.",
    ]);
  });
});

describe("readBaseMinPassedTests", () => {
  it("treats a baseline missing on the base branch as 0", () => {
    const missing = () => {
      throw new Error("fatal: path '.github/test-baseline.json' does not exist");
    };

    expect(readBaseMinPassedTests("origin/main", missing)).toBe(0);
    expect(
      evaluateBaseline({ counts: counts(), minPassedTests: 13, baseMinPassedTests: 0 }),
    ).toEqual([]);
  });

  it("reads the baseline committed on the base branch", () => {
    const show = () => JSON.stringify({ minPassedTests: 13 });

    expect(readBaseMinPassedTests("origin/main", show)).toBe(13);
  });
});
