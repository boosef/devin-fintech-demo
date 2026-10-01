#!/usr/bin/env node
// Scaffolds team-apps/<name>/ from scripts/create-team-app/templates/, wired
// into lint, typecheck, test and the per-package baseline guard.
// Usage: pnpm create-team-app <name>
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(here, "..");
export const TEMPLATES_DIR = join(here, "create-team-app", "templates");
export const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export function packageName(name) {
  return `@acme/team-${name}`;
}

/** True if git would ignore team-apps/<name>, so the app could never be committed. */
function isGitIgnored(name) {
  try {
    execFileSync("git", ["check-ignore", "-q", `team-apps/${name}/package.json`], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function copyTemplates(fromDir, toDir, vars) {
  mkdirSync(toDir, { recursive: true });
  for (const entry of readdirSync(fromDir, { withFileTypes: true })) {
    const from = join(fromDir, entry.name);
    const to = join(toDir, entry.name);
    if (entry.isDirectory()) {
      copyTemplates(from, to, vars);
    } else {
      const content = readFileSync(from, "utf8").replace(/\{\{(name|pkgName)\}\}/g, (_, key) => vars[key]);
      writeFileSync(to, content);
    }
  }
}

/**
 * Writes the team-app templates for `name` into `targetDir`
 * (default `team-apps/<name>`) and returns that directory.
 */
export function createTeamApp(name, targetDir = join(REPO_ROOT, "team-apps", name)) {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`invalid name "${name}": use lowercase letters, digits and dashes, starting with a letter`);
  }
  if (isGitIgnored(name)) {
    throw new Error(
      `invalid name "${name}": team-apps/${name} is ignored by .gitignore, so it could not be committed`,
    );
  }
  if (existsSync(targetDir)) {
    throw new Error(`${relative(REPO_ROOT, targetDir)} already exists`);
  }
  copyTemplates(TEMPLATES_DIR, targetDir, { name, pkgName: packageName(name) });
  return targetDir;
}

function main() {
  const [name, ...rest] = process.argv.slice(2);
  if (name === undefined || rest.length > 0) {
    console.error("Usage: pnpm create-team-app <name>");
    process.exit(1);
  }
  let dir;
  try {
    dir = relative(REPO_ROOT, createTeamApp(name));
  } catch (error) {
    console.error(`[create-team-app] ${error.message}`);
    process.exit(1);
  }
  console.log(`[create-team-app] Created ${dir} (${packageName(name)}).

Next steps:
  pnpm install
  pnpm lint && pnpm typecheck && pnpm test:ci

Read ${dir}/README.md and PLAYBOOK.md section 6 before building on it.`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
