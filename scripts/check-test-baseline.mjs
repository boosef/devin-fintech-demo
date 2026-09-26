#!/usr/bin/env node
// Test-count ratchet: the committed baseline must equal the number of passing
// tests, and may only go up. Deleting or skipping a test fails the build, and
// adding tests without raising the baseline does too, so the baseline can never
// go stale. Raising it requires a CODEOWNERS review (.github/** is owned).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RESULTS_PATH = resolve(process.cwd(), "test-results.json");
const BASELINE_PATH = resolve(process.cwd(), ".github/test-baseline.json");
const BASELINE_FILE = ".github/test-baseline.json";

/**
 * Reads `minPassedTests` from the baseline file as it exists on `ref`.
 * A baseline that does not exist there yet (new repo, new file) counts as 0.
 */
export function readBaseMinPassedTests(ref, showFile = defaultShowFile) {
  let raw;
  try {
    raw = showFile(ref, BASELINE_FILE);
  } catch {
    return 0;
  }
  const parsed = JSON.parse(raw);
  return typeof parsed.minPassedTests === "number" ? parsed.minPassedTests : 0;
}

function defaultShowFile(ref, file) {
  return execFileSync("git", ["show", `${ref}:${file}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** Returns a list of human-readable failures; empty means the guard passes. */
export function evaluateBaseline({ counts, minPassedTests, baseMinPassedTests = 0 }) {
  const failures = [];

  if (counts.passed > minPassedTests) {
    failures.push(
      `Passed ${counts.passed} tests but baseline is ${minPassedTests}. Raise minPassedTests to ${counts.passed} in ${BASELINE_FILE} in this PR.`,
    );
  }

  if (counts.passed < minPassedTests) {
    failures.push(
      `passed test count regressed: ${counts.passed} passed, baseline requires at least ${minPassedTests}. Tests were deleted or are no longer passing — fix the code instead of removing tests.`,
    );
  }

  if (minPassedTests < baseMinPassedTests) {
    failures.push(
      `baseline was lowered: minPassedTests is ${minPassedTests} but the base branch requires ${baseMinPassedTests}. The ratchet only goes up.`,
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

  return failures;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`[test-baseline] could not read ${path}: ${error.message}`);
    process.exit(1);
  }
}

function main() {
  const results = readJson(RESULTS_PATH);
  const baseline = readJson(BASELINE_PATH);

  const minPassedTests = baseline.minPassedTests;
  if (typeof minPassedTests !== "number" || !Number.isInteger(minPassedTests)) {
    console.error(
      `[test-baseline] ${BASELINE_FILE} must contain an integer "minPassedTests", got: ${JSON.stringify(baseline.minPassedTests)}`,
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

  // BASE_REF is set by CI (origin/<base branch>); locally there is nothing to
  // compare against, so the ratchet floor is 0.
  const baseRef = process.env.BASE_REF;
  const baseMinPassedTests = baseRef ? readBaseMinPassedTests(baseRef) : 0;

  const failures = evaluateBaseline({ counts, minPassedTests, baseMinPassedTests });

  if (failures.length > 0) {
    console.error("[test-baseline] FAILED");
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
      `[test-baseline] counts: passed=${counts.passed} failed=${counts.failed} skipped=${counts.pending} todo=${counts.todo}, minPassedTests=${minPassedTests}, base minPassedTests=${baseMinPassedTests}`,
    );
    process.exit(1);
  }

  console.log(
    `[test-baseline] OK: ${counts.passed} passed (baseline ${minPassedTests}, base ${baseMinPassedTests}), 0 failed, 0 skipped, 0 todo.`,
  );
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
