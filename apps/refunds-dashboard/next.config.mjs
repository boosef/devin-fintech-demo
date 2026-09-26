/** @type {import("next").NextConfig} */
const nextConfig = {
  transpilePackages: ["@acme/audit-log", "@acme/auth-guard"],
  serverExternalPackages: ["better-sqlite3"],
  // Repo-level AGENTS.md governs agents here; don't generate per-app copies.
  agentRules: false,
};

export default nextConfig;
