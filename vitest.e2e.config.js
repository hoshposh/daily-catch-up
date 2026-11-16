import { defineConfig } from "vitest/config";

// End-to-end tests drive the running Obsidian app, so they share one window:
// files and tests run one at a time.
export default defineConfig({
  test: {
    include: ["e2e/**/*.e2e.js"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 60000,
    hookTimeout: 120000,
  },
});
