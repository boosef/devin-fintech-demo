import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@acme/auth-guard",
    include: ["tests/**/*.test.ts"],
  },
});
