import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@acme/audit-log",
    include: ["tests/**/*.test.ts"],
  },
});
