import { readFile, rm } from "node:fs/promises";
import { preparePhase3Application, seedPhase3Identities } from "../../tests/e2e/fixtures/phase3-server";
import { PHASE3_PROVIDER, phase3PersonaNames, phase3UserId } from "../../tests/e2e/fixtures/phase3-identities";
import path from "node:path";
import { assertE2eCounts, createE2eRunDirectory, recordE2eRun, type E2eCounts, type E2eRunReport } from "./e2e-report";
import { e2eTeamWorkspacesEnabled, requiredE2eServices } from "./e2e-services";
import { spawn, type ChildProcess } from "node:child_process";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { runMigrations } from "../db/migrate";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../db/test-database";
import { seedDevelopmentDatabase } from "../db/seed";

const projectRoot = process.cwd();
const environmentNames = [
  "KM_IDENTITY_PROVIDER", "NODE_ENV", "PORT", "KM_E2E_PORT", "KM_DB_HOST", "KM_DB_PORT", "KM_DB_USER", "KM_DB_PASSWORD", "KM_DB_NAME",
  "KM_E2E_DB_HOST", "KM_E2E_DB_PORT", "KM_E2E_DB_USER", "KM_E2E_DB_PASSWORD", "KM_E2E_DB_NAME",
  "KM_LOCAL_IDENTITY_ENABLED", "KM_LOCAL_ID", "KM_LOCAL_EMP_ID", "KM_LOCAL_NAME", "KM_LOCAL_ORG_CODE",
  "KM_ALLOW_LOCAL_IDENTITY_IN_PRODUCTION", "KM_TEAM_WORKSPACES_ENABLED",
];

function createCancellation() {
  let signal: NodeJS.Signals | undefined;
  let child: ChildProcess | undefined;
  const stop = (received: NodeJS.Signals) => {
    signal ??= received;
    // Await the child exit before main's finally disposes its database.
    child?.kill("SIGTERM");
  };
  const interrupt = () => stop("SIGINT");
  const terminate = () => stop("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  const check = () => {
    if (signal) throw new Error(`E2E cancelled by ${signal}.`);
  };
  return {
    check,
    isCancelled: () => Boolean(signal),
    dispose() { process.off("SIGINT", interrupt); process.off("SIGTERM", terminate); },
    async run(command: string, args: string[], environment: NodeJS.ProcessEnv, cwd = projectRoot, capture = false): Promise<string> {
      check();
      let output = "";
      await new Promise<void>((resolve, reject) => {
        const running = spawn(process.execPath, [command, ...args], { cwd, env: environment, stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit" });
        if (capture) running.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        child = running;
        running.once("error", (error) => { child = undefined; reject(error); });
        running.once("close", (code, childSignal) => {
          child = undefined;
          if (code === 0) resolve();
          else reject(new Error(`${command} exited with ${code ?? `signal ${childSignal ?? "unknown"}`}.`));
        });
      });
      check();
      return output;
    },
  };
}

async function main(): Promise<void> {
  const previous = new Map(environmentNames.map((name) => [name, process.env[name]]));
  const teamMode = e2eTeamWorkspacesEnabled(process.env);
  const suite = process.env.KM_E2E_SUITE ?? (teamMode === "true" ? "full" : "personal");
  const reportDirectory = await createE2eRunDirectory(path.join(projectRoot, "playwright-report/e2e-runs"), suite);
  console.log(`[e2e] artifacts: ${path.relative(projectRoot, reportDirectory)}`);
  const cancellation = createCancellation();
  let handle: Awaited<ReturnType<typeof provisionIsolatedDatabase>> | undefined;
  let phase3Root: string | undefined;
  let runReport: E2eRunReport;
  async function timed<T>(label: string, action: () => Promise<T>): Promise<T> {
    const before = performance.now();
    let status: "passed" | "failed" = "failed";
    try { const result = await action(); status = "passed"; return result; }
    finally {
      const durationMs = performance.now() - before;
      runReport.stages.push({ name: label, durationMs, status });
      console.log(`[e2e] ${label}: ${(durationMs / 1000).toFixed(2)}s (${status})`);
    }
  }
  try {
    await recordE2eRun(reportDirectory, suite, teamMode === "true" ? "Team-enabled" : "personal-only", async (report) => {
      runReport = report;
      // Let Playwright resolve file filters/grep/projects, avoiding a second selector implementation.
      const listingEnvironment = { ...process.env, KM_TEAM_WORKSPACES_ENABLED: teamMode, KM_PHASE3_APP_ROOT: undefined, KM_E2E_UNCONFIGURED_SERVER: "false", KM_E2E_TEAMS_CLOSED_SERVER: "false", PLAYWRIGHT_JSON_OUTPUT_FILE: undefined, PLAYWRIGHT_JSON_OUTPUT_DIR: undefined, PLAYWRIGHT_JSON_OUTPUT_NAME: undefined };
      const listing = JSON.parse(await timed("test discovery", () => cancellation.run("node_modules/@playwright/test/cli.js", ["test", ...process.argv.slice(2), "--list", "--reporter=json"], listingEnvironment, projectRoot, true))) as { suites: Array<{ file?: string; specs?: unknown[]; suites?: unknown[] }>; errors?: unknown[] };
      if (listing.errors?.length) throw new Error("Playwright test discovery failed.");
      const files = new Set<string>();
      function collect(suites: typeof listing.suites) {
        for (const suite of suites) {
          if (suite.file && suite.specs?.length) files.add(path.resolve(projectRoot, "tests/e2e", suite.file));
          collect((suite.suites ?? []) as typeof listing.suites);
        }
      }
      collect(listing.suites);
      if (!files.size) throw new Error("No E2E tests selected.");
      const services = requiredE2eServices(await Promise.all([...files].map((file) => readFile(file, "utf8"))));
      if (process.env.KM_E2E_PERSONAL_ONLY === "true" && services.personas) {
        throw new Error("Selected tests require SSO personas; remove KM_E2E_PERSONAL_ONLY=true.");
      }
      console.log(`[e2e] mode: ${teamMode === "true" ? "Team-enabled" : "personal-only"}`);
      console.log(`[e2e] services: local${services.teamsClosed ? ", teams-closed" : ""}${services.personas ? ", SSO personas" : ""}${services.unconfigured ? ", unconfigured" : ""}`);
      handle = await timed("database provisioning", () => provisionIsolatedDatabase("e2e"));
      cancellation.check();
      const e2ePort = process.env.KM_E2E_PORT ?? "3101";
      const dbHost = process.env.KM_E2E_DB_HOST ?? process.env.KM_TEST_DB_HOST ?? "127.0.0.1";
      const dbPort = process.env.KM_E2E_DB_PORT ?? process.env.KM_TEST_DB_PORT ?? "3307";
      const dbUser = process.env.KM_E2E_DB_USER ?? process.env.KM_TEST_DB_USER ?? "root";
      const dbPassword = process.env.KM_E2E_DB_PASSWORD ?? process.env.KM_TEST_DB_PASSWORD ?? "hcm_km_root";
      const identity = {
        KM_LOCAL_IDENTITY_ENABLED: "true",
        KM_ALLOW_LOCAL_IDENTITY_IN_PRODUCTION: "true",
        KM_LOCAL_ID: "0199f000-0000-7000-8000-000000000909",
        KM_LOCAL_EMP_ID: "E2E-0909",
        KM_LOCAL_NAME: "E2E Knowledge User",
        KM_LOCAL_ORG_CODE: "E2E",
      };
      const commonEnvironment: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_ENV: "production",
        KM_IDENTITY_PROVIDER: "local",
        ...identity,
        KM_TEAM_WORKSPACES_ENABLED: teamMode,
        KM_E2E_PORT: e2ePort,
        KM_E2E_DB_HOST: dbHost,
        KM_E2E_DB_PORT: dbPort,
        KM_E2E_DB_USER: dbUser,
        KM_E2E_DB_PASSWORD: dbPassword,
        KM_E2E_DB_NAME: handle.databaseName,
        KM_DB_HOST: dbHost,
        KM_DB_PORT: dbPort,
        KM_DB_USER: dbUser,
        KM_DB_PASSWORD: dbPassword,
        KM_DB_NAME: handle.databaseName,
      };
      Object.assign(process.env, commonEnvironment);
      const migrationPool = createDatabasePool(databaseConfig("e2e"));
      try {
        await timed("database migrations", () => runMigrations(migrationPool));
      } finally {
        await migrationPool.end();
      }
      cancellation.check();
      await timed("development fixtures", () => seedDevelopmentDatabase());
      cancellation.check();
      const fixturePool = createDatabasePool(databaseConfig("e2e"));
      try { if (services.personas) await timed("SSO fixtures", () => seedPhase3Identities(fixturePool)); } finally { await fixturePool.end(); }
      cancellation.check();
      await timed("application build", () => cancellation.run("node_modules/next/dist/bin/next", ["build"], { ...commonEnvironment, NODE_ENV: "production" }));
      if (services.personas) phase3Root = await timed("SSO application preparation", () => preparePhase3Application(projectRoot));
      cancellation.check();
      const phase3Environment = {
        ...commonEnvironment, KM_IDENTITY_PROVIDER: "company-sso", KM_COMPANY_SSO_PROVIDER: PHASE3_PROVIDER,
        KM_COMPANY_SSO_TEAM_CREATE_GROUPS: "phase3-creators",
        KM_COMPANY_SSO_ROLLOUT_USER_IDS: phase3PersonaNames.map(phase3UserId).join(","),
        KM_PHASE3_SERVER_PERSONA: "owner",
      };
      cancellation.check();
      if (phase3Root) await timed("SSO application build", () => cancellation.run("node_modules/next/dist/bin/next", ["build"], phase3Environment, phase3Root));
      cancellation.check();
      await timed("server readiness and browser tests", () => cancellation.run("node_modules/@playwright/test/cli.js", ["test", ...process.argv.slice(2)], {
        ...commonEnvironment, NODE_ENV: "production", PORT: e2ePort,
        KM_E2E_RUN_REPORT_DIR: reportDirectory,
        KM_PHASE3_APP_ROOT: phase3Root,
        KM_E2E_TEAMS_CLOSED_SERVER: String(services.teamsClosed),
        KM_E2E_UNCONFIGURED_SERVER: String(services.unconfigured),
        KM_COMPANY_SSO_ROLLOUT_USER_IDS: phase3Environment.KM_COMPANY_SSO_ROLLOUT_USER_IDS,
      }));
      const browserReport = JSON.parse(await readFile(path.join(reportDirectory, "tests.json"), "utf8")) as { counts: E2eCounts };
      runReport.counts = browserReport.counts;
      assertE2eCounts(browserReport.counts, suite);
    }, async (report) => {
      runReport = report;
      // Even if Playwright exits nonzero, its reporter may have written useful outcomes.
      const cleanupErrors: unknown[] = [];
      try {
        report.counts = (JSON.parse(await readFile(path.join(reportDirectory, "tests.json"), "utf8")) as { counts: E2eCounts }).counts;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") cleanupErrors.push(error);
      }
      try { if (phase3Root) await timed("SSO application cleanup", () => rm(phase3Root!, { recursive: true, force: true })); }
      catch (error) { cleanupErrors.push(error); }
      try { if (handle) await timed("database cleanup", () => disposeIsolatedDatabase(handle!)); }
      catch (error) { cleanupErrors.push(error); }
      if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "E2E cleanup failed.");
    }, cancellation.isCancelled);
  } finally {
    cancellation.dispose();
    for (const name of environmentNames) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    try {
      const report = JSON.parse(await readFile(path.join(reportDirectory, "runner.json"), "utf8")) as E2eRunReport;
      console.log(`[e2e] total: ${(report.durationMs / 1000).toFixed(2)}s (${report.status})`);
    } catch { /* Preserve the primary error if report writing itself failed. */ }
  }
}

main().catch((error: unknown) => {
  if (error instanceof AggregateError) for (const cause of error.errors) console.error(cause instanceof Error ? cause.message : cause);
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
