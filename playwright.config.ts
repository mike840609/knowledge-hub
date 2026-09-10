import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.KM_E2E_PORT ?? "3101");

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  reporter: [["list"]],
  webServer: {
    command: `${process.execPath} node_modules/next/dist/bin/next start --hostname 127.0.0.1`,
    url: `http://127.0.0.1:${port}/knowledge`,
    timeout: 30_000,
    reuseExistingServer: false,
    env: { ...process.env, NODE_ENV: "production", PORT: String(port) } as Record<string, string>,
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
});
