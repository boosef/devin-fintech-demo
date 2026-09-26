/** @type {import("next").NextConfig} */
const nextConfig = {
  transpilePackages: ["@acme/audit-log", "@acme/auth-guard"],
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
