import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { balancedE2eGroups, E2E_GROUP_COUNT } from "./scripts/test/e2e-shards";
import { PHASE3_PROVIDER, phase3Origin, phase3PersonaNames, phase3NoSessionOrigin, phase3UnconfiguredOrigin } from "./tests/e2e/fixtures/phase3-identities";
import { teamsClosedOrigin } from "./tests/e2e/fixtures/teams-closed";

const port = Number(process.env.KM_E2E_PORT ?? "3101");
const phase3Root = process.env.KM_PHASE3_APP_ROOT;
const group = process.env.KM_E2E_GROUP;
if (group && !/^[12]$/.test(group)) throw new Error(`KM_E2E_GROUP must be between 1 and ${E2E_GROUP_COUNT}`);
const files = group ? readdirSync(path.join(process.cwd(), "tests/e2e"), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.ts"))
  .map((entry) => {
    const absolute = path.join(entry.parentPath, entry.name);
    return { file: path.relative(path.join(process.cwd(), "tests/e2e"), absolute).replaceAll(path.sep, "/"), source: readFileSync(absolute, "utf8") };
  }) : [];
const groups = balancedE2eGroups(files);
const localServer = {
  command: `${process.execPath} node_modules/next/dist/bin/next start --hostname 127.0.0.1`,
  url: `http://127.0.0.1:${port}/`, timeout: 60_000, reuseExistingServer: false,
  env: { ...process.env, NODE_ENV: "production", KM_IDENTITY_PROVIDER: "local", PORT: String(port) } as Record<string, string>,
};
// The same build and database, with Team workspaces closed: what the switcher says while they are.
const teamsClosedServer = {
  ...localServer,
  url: `${teamsClosedOrigin()}/`,
  env: { ...localServer.env, PORT: new URL(teamsClosedOrigin()).port, KM_TEAM_WORKSPACES_ENABLED: "false" },
};
export default defineConfig({
  testDir: "./tests/e2e", timeout: 30_000, fullyParallel: false, workers: 1, reporter: [["list"]],
  ...(group ? { testMatch: files.filter(({ file }) => groups.get(file) === Number(group)).map(({ file }) => `**/${file}`) } : {}),
  webServer: [localServer, ...(process.env.KM_E2E_TEAMS_CLOSED_SERVER === "false" ? [] : [teamsClosedServer]), ...(phase3Root ? [...phase3PersonaNames, ...(process.env.KM_E2E_NO_SESSION_SERVER === "true" ? ["noSession" as const] : [])].map((persona) => ({
    command: `${process.execPath} node_modules/next/dist/bin/next start --hostname 127.0.0.1`,
    cwd: phase3Root, url: persona === "noSession" ? `${phase3NoSessionOrigin()}/_next/static/${readFileSync(path.join(phase3Root, ".next/BUILD_ID"), "utf8").trim()}/_buildManifest.js` : `${phase3Origin(persona)}/`, timeout: 60_000, reuseExistingServer: false,
    env: {
      ...process.env, NODE_ENV: "production", PORT: new URL((persona === "noSession" ? phase3NoSessionOrigin() : phase3Origin(persona))).port,
      KM_IDENTITY_PROVIDER: "company-sso", KM_COMPANY_SSO_PROVIDER: PHASE3_PROVIDER,
      KM_COMPANY_SSO_TEAM_CREATE_GROUPS: "phase3-creators", KM_PHASE3_SERVER_PERSONA: persona,
    } as Record<string, string>,
  })) : []), ...((process.env.KM_E2E_UNCONFIGURED_SERVER === "true" || (phase3Root && process.env.KM_E2E_UNCONFIGURED_SERVER !== "false")) ? [{
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
