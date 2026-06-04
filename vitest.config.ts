import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // No network in tests — everything runs against fixtures.
    testTimeout: 10_000,
  },
});
