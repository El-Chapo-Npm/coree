import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    threads: true,
    maxWorkers: 2,
    minWorkers: 1,
    isolate: true,
    coverage: {
      enabled: false,
    },
    // Disable worker cleanup to avoid OOM during teardown
    teardownTimeout: 10000,
  },
});
