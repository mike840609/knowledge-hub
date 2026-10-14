import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Legacy governance scenarios explicitly exercise the Team-enabled rollout.
    // KM_BLOB_DIR empty: a developer's .env must not switch image storage on for every suite; the image suites pass a store explicitly.
    env: { KM_TEAM_WORKSPACES_ENABLED: "true", KM_BLOB_DIR: "", KM_BLOB_S3_BUCKET: "" },
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
