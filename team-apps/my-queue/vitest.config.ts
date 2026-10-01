import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@acme/team-my-queue",
    include: ["tests/**/*.test.ts"],
  },
});
