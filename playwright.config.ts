import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { PHASE3_PROVIDER, phase3Origin, phase3PersonaNames, phase3UnconfiguredOrigin } from "./tests/e2e/fixtures/phase3-identities";

const port = Number(process.env.KM_E2E_PORT ?? "3101");
const phase3Root = process.env.KM_PHASE3_APP_ROOT;
const localServer = {
  command: `${process.execPath} node_modules/next/dist/bin/next start --hostname 127.0.0.1`,
  url: `http://127.0.0.1:${port}/`, timeout: 60_000, reuseExistingServer: false,
  env: { ...process.env, NODE_ENV: "production", KM_IDENTITY_PROVIDER: "local", PORT: String(port) } as Record<string, string>,
};
export default defineConfig({
  testDir: "./tests/e2e", timeout: 30_000, fullyParallel: false, workers: 1, reporter: [["list"]],
  webServer: [localServer, ...(phase3Root ? phase3PersonaNames.map((persona) => ({
    command: `${process.execPath} node_modules/next/dist/bin/next start --hostname 127.0.0.1`,
    cwd: phase3Root, url: `${phase3Origin(persona)}/`, timeout: 60_000, reuseExistingServer: false,
    env: {
      ...process.env, NODE_ENV: "production", PORT: new URL(phase3Origin(persona)).port,
      KM_IDENTITY_PROVIDER: "company-sso", KM_COMPANY_SSO_PROVIDER: PHASE3_PROVIDER,
      KM_COMPANY_SSO_TEAM_CREATE_GROUPS: "phase3-creators", KM_PHASE3_SERVER_PERSONA: persona,
    } as Record<string, string>,
  })) : []), ...(phase3Root ? [{
    ...localServer,
    // Static readiness probe lets an intentionally fail-closed Company server boot.
    url: `${phase3UnconfiguredOrigin()}/_next/static/${readFileSync(".next/BUILD_ID", "utf8").trim()}/_buildManifest.js`,
    env: {
      ...process.env, NODE_ENV: "production", PORT: new URL(phase3UnconfiguredOrigin()).port,
      KM_IDENTITY_PROVIDER: "company-sso", KM_COMPANY_SSO_PROVIDER: PHASE3_PROVIDER,
      KM_COMPANY_SSO_TEAM_CREATE_GROUPS: "phase3-creators", KM_PHASE3_SERVER_PERSONA: "owner",
    } as Record<string, string>,
  }] : [])],
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
});
