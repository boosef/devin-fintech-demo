import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "my-queue",
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
