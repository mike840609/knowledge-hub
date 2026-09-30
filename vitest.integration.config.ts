import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Legacy governance scenarios explicitly exercise the Team-enabled rollout.
    env: { KM_TEAM_WORKSPACES_ENABLED: "true" },
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    globals: false,
    restoreMocks: true,
  },
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
});
