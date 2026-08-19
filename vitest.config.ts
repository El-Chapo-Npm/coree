import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    threads: true,
    maxWorkers: 4,
    minWorkers: 1,
    isolate: true,
    // Disable coverage to save memory
    coverage: {
      enabled: false,
    },
  },
});
