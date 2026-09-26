#!/usr/bin/env node
// Test-count regression guard: stops a failing test from being "fixed" by
// deleting or skipping it. Raising the baseline requires a CODEOWNERS review.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RESULTS_PATH = resolve(process.cwd(), "test-results.json");
const BASELINE_PATH = resolve(process.cwd(), ".github/test-baseline.json");

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`[test-baseline] could not read ${path}: ${error.message}`);
    process.exit(1);
  }
}

const results = readJson(RESULTS_PATH);
const baseline = readJson(BASELINE_PATH);

const minPassedTests = baseline.minPassedTests;
if (typeof minPassedTests !== "number" || !Number.isInteger(minPassedTests)) {
  console.error(
    `[test-baseline] .github/test-baseline.json must contain an integer "minPassedTests", got: ${JSON.stringify(baseline.minPassedTests)}`,
  );
  process.exit(1);
}

const counts = {
  passed: results.numPassedTests,
  failed: results.numFailedTests,
  pending: results.numPendingTests,
  todo: results.numTodoTests,
};

for (const [name, value] of Object.entries(counts)) {
  if (typeof value !== "number") {
    console.error(
      `[test-baseline] test-results.json is missing a numeric num${name[0].toUpperCase()}${name.slice(1)}Tests field`,
    );
    process.exit(1);
  }
}

const failures = [];

if (counts.passed < minPassedTests) {
  failures.push(
    `passed test count regressed: ${counts.passed} passed, baseline requires at least ${minPassedTests}. Tests were deleted or are no longer passing — fix the code instead of removing tests.`,
  );
}

if (counts.pending > 0 || counts.todo > 0) {
  failures.push(
    `skipped or todo tests present: ${counts.pending} skipped, ${counts.todo} todo. A skipped test counts as a removed test.`,
  );
}

if (counts.failed > 0) {
  failures.push(`${counts.failed} test(s) failed.`);
}

if (failures.length > 0) {
  console.error("[test-baseline] FAILED");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    `[test-baseline] counts: passed=${counts.passed} failed=${counts.failed} skipped=${counts.pending} todo=${counts.todo}, minPassedTests=${minPassedTests}`,
  );
  process.exit(1);
}

console.log(
  `[test-baseline] OK: ${counts.passed} passed (baseline ${minPassedTests}), 0 failed, 0 skipped, 0 todo.`,
);
