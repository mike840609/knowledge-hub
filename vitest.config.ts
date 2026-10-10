import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // A developer's .env must not switch image storage on in unit tests.
    env: { KM_BLOB_DIR: "", KM_BLOB_S3_BUCKET: "" },
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    globals: false,
    restoreMocks: true,
  },
  // tsconfig sets jsx: "preserve" for Next, which leaves esbuild on the
  // classic runtime and makes a rendered component fail on "React is not
  // defined". Tests render primitives, so they need the automatic one.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
});
