#!/usr/bin/env node
// Per-package test-count ratchet. Every workspace dir with tests commits a
// `<dir>/test-baseline.json` ({ "minPassedTests": N }) that must equal the
// number of passing tests in `<dir>/test-results.json` exactly, and may only go
// up. Deleting or skipping a test fails the build, and adding tests without
// raising that package's baseline does too, so no baseline can go stale.
// A baseline may only disappear if the package is listed in
// .github/removed-workspaces.json, which is security-owned.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const WORKSPACE_FILE = "pnpm-workspace.yaml";
export const REMOVED_FILE = ".github/removed-workspaces.json";
// Vitest projects that are not pnpm workspace packages.
export const EXTRA_DIRS = ["scripts"];
const BASELINE = "test-baseline.json";
const RESULTS = "test-results.json";
const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", "coverage", "dist"]);
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** Reads the `packages:` globs from pnpm-workspace.yaml, plus EXTRA_DIRS. */
export function parseWorkspaceGlobs(yaml) {
  const globs = [];
  let inPackages = false;
  for (const line of yaml.split("\n")) {
    if (/^\S/.test(line)) inPackages = line.startsWith("packages:");
    const item = inPackages && line.match(/^\s+-\s+['"]?([^'"#\s]+)['"]?/);
    if (item && !item[1].startsWith("!")) globs.push(item[1]);
  }
  return [...globs, ...EXTRA_DIRS];
}

export function matchesGlob(dir, glob) {
  if (!glob.endsWith("/*")) return dir === glob;
  const prefix = glob.slice(0, -1);
  return dir.startsWith(prefix) && !dir.slice(prefix.length).includes("/");
}

function expandGlobs(globs, root) {
  return globs.flatMap((glob) => {
    if (!glob.endsWith("/*")) return existsSync(join(root, glob)) ? [glob] : [];
    const parent = glob.slice(0, -2);
    if (!existsSync(join(root, parent))) return [];
    return readdirSync(join(root, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`);
  });
}

function hasTestFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).some((entry) =>
    entry.isDirectory()
      ? !SKIP_DIRS.has(entry.name) && hasTestFiles(join(dir, entry.name))
      : TEST_FILE.test(entry.name),
  );
}

function hasTestScript(dir) {
  const pkg = join(dir, "package.json");
  return existsSync(pkg) && typeof JSON.parse(readFileSync(pkg, "utf8")).scripts?.test === "string";
}

/**
 * Reads `minPassedTests` from a baseline file as it exists on `ref`.
 * A baseline that does not exist there yet (new package, new file) counts as 0.
 */
export function readBaseMinPassedTests(ref, file, showFile = defaultShowFile) {
  let raw;
  try {
    raw = showFile(ref, file);
  } catch {
    return 0;
  }
  const parsed = JSON.parse(raw);
  return typeof parsed.minPassedTests === "number" ? parsed.minPassedTests : 0;
}

function readBaseFile(ref, file) {
  try {
    return defaultShowFile(ref, file);
  } catch {
    return "";
  }
}

function defaultShowFile(ref, file) {
  return execFileSync("git", ["show", `${ref}:${file}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** Workspace dirs (matching `globs`) that have a committed baseline on `ref`. */
export function listBaseBaselineDirs(ref, globs, listFiles = defaultListFiles) {
  return listFiles(ref)
    .filter((file) => file.endsWith(`/${BASELINE}`))
    .map((file) => file.slice(0, -BASELINE.length - 1))
    .filter((dir) => globs.some((glob) => matchesGlob(dir, glob)));
}

function defaultListFiles(ref) {
  return execFileSync("git", ["ls-tree", "-r", "--name-only", ref], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

/** Returns a list of human-readable failures; empty means the guard passes. */
export function evaluateBaseline({ counts, minPassedTests, baseMinPassedTests = 0, baselineFile }) {
  const failures = [];

  if (counts.passed > minPassedTests) {
    failures.push(
      `Passed ${counts.passed} tests but baseline is ${minPassedTests}. Raise minPassedTests to ${counts.passed} in ${baselineFile} in this PR.`,
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

const ZERO = { passed: 0, failed: 0, pending: 0, todo: 0 };

/**
 * Evaluates every workspace. Each workspace is
 * `{ dir, hasTests, counts, minPassedTests, baseMinPassedTests }`, where
 * `counts` / `minPassedTests` are null when the results / baseline file is
 * missing. Dirs in `baseBaselineDirs` that are not in `workspaces` were
 * deleted outright. Every failure is prefixed with its package path.
 */
export function evaluateWorkspaces({ workspaces, baseBaselineDirs = [], removed = [] }) {
  const known = new Set(workspaces.map((w) => w.dir));
  const gone = baseBaselineDirs
    .filter((dir) => !known.has(dir))
    .map((dir) => ({ dir, hasTests: false, counts: null, minPassedTests: null }));
  const failures = [];
  let passed = 0;
  let minPassedTests = 0;

  for (const ws of [...workspaces, ...gone]) {
    const baselineFile = `${ws.dir}/${BASELINE}`;
    const fail = (message) => failures.push(`${ws.dir}: ${message}`);
    if (ws.minPassedTests === null) {
      if (ws.hasTests) {
        fail(`has tests but no ${baselineFile}. Add { "minPassedTests": N } with its passing count.`);
      } else if (baseBaselineDirs.includes(ws.dir) && !removed.includes(ws.dir)) {
        fail(`${baselineFile} exists on the base branch but was deleted. List "${ws.dir}" in ${REMOVED_FILE} to remove a workspace.`);
      }
      continue;
    }
    if (ws.hasTests && ws.counts === null) {
      fail(`no ${ws.dir}/${RESULTS}; its test script must run \`vitest run --reporter=json --outputFile=${RESULTS}\`.`);
      continue;
    }
    const counts = ws.counts ?? ZERO;
    passed += counts.passed;
    minPassedTests += ws.minPassedTests;
    const args = { counts, minPassedTests: ws.minPassedTests, baseMinPassedTests: ws.baseMinPassedTests ?? 0, baselineFile };
    evaluateBaseline(args).forEach(fail);
  }

  return { failures, totals: { passed, minPassedTests } };
}

function readJsonFile(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

function loadWorkspace(dir, baseRef) {
  const baseline = readJsonFile(join(dir, BASELINE));
  const results = readJsonFile(join(dir, RESULTS));
  const minPassedTests = baseline?.minPassedTests ?? null;
  if (baseline && !Number.isInteger(minPassedTests)) {
    throw new Error(`${dir}/${BASELINE} must contain an integer "minPassedTests"`);
  }
  const counts = results && {
    passed: results.numPassedTests,
    failed: results.numFailedTests,
    pending: results.numPendingTests,
    todo: results.numTodoTests,
  };
  if (counts && Object.values(counts).some((value) => typeof value !== "number")) {
    throw new Error(`${dir}/${RESULTS} is missing numeric num*Tests fields`);
  }
  return {
    dir,
    hasTests: hasTestScript(dir) || hasTestFiles(dir),
    counts,
    minPassedTests,
    // BASE_REF is set by CI (origin/<base branch>); locally the floor is 0.
    baseMinPassedTests: baseRef ? readBaseMinPassedTests(baseRef, `${dir}/${BASELINE}`) : 0,
  };
}

function main() {
  const baseRef = process.env.BASE_REF;
  const globs = parseWorkspaceGlobs(readFileSync(WORKSPACE_FILE, "utf8"));
  let result;
  try {
    const workspaces = expandGlobs(globs, process.cwd()).map((dir) => loadWorkspace(dir, baseRef));
    // Base-branch globs too, so dropping a glob cannot hide a deleted baseline.
    const baseGlobs = baseRef ? parseWorkspaceGlobs(readBaseFile(baseRef, WORKSPACE_FILE)) : [];
    const baseBaselineDirs = baseRef ? listBaseBaselineDirs(baseRef, [...globs, ...baseGlobs]) : [];
    const removed = readJsonFile(REMOVED_FILE)?.removed ?? [];
    result = evaluateWorkspaces({ workspaces, baseBaselineDirs, removed });
  } catch (error) {
    console.error(`[test-baselines] ${error.message}`);
    process.exit(1);
  }

  const { failures, totals } = result;
  if (failures.length > 0) {
    console.error("[test-baselines] FAILED");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(
    `[test-baselines] OK: ${totals.passed} passed across all packages (baselines sum to ${totals.minPassedTests}), 0 failed, 0 skipped, 0 todo.`,
  );
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
