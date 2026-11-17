import { defineConfig } from "vitest/config";

// Demos record the running Obsidian app (pnpm demo <name>). Like the e2e
// tests they share one window, so files and tests run one at a time.
export default defineConfig({
  test: {
    include: ["e2e/demos/**/*.demo.js"],
    globalSetup: ["e2e/setup.js"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 180000,
    hookTimeout: 120000,
  },
});
