import { rm } from "node:fs/promises";
import { preparePhase3Application, seedPhase3Identities } from "../../tests/e2e/fixtures/phase3-server";
import { PHASE3_PROVIDER, phase3PersonaNames, phase3UserId } from "../../tests/e2e/fixtures/phase3-identities";
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
  "KM_ALLOW_LOCAL_IDENTITY_IN_PRODUCTION",
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
    dispose() { process.off("SIGINT", interrupt); process.off("SIGTERM", terminate); },
    async run(command: string, args: string[], environment: NodeJS.ProcessEnv, cwd = projectRoot): Promise<void> {
      check();
      await new Promise<void>((resolve, reject) => {
        const running = spawn(process.execPath, [command, ...args], { cwd, env: environment, stdio: "inherit" });
        child = running;
        running.once("error", (error) => { child = undefined; reject(error); });
        running.once("exit", (code, childSignal) => {
          child = undefined;
          if (code === 0) resolve();
          else reject(new Error(`${command} exited with ${code ?? `signal ${childSignal ?? "unknown"}`}.`));
        });
      });
      check();
    },
  };
}

async function main(): Promise<void> {
  const previous = new Map(environmentNames.map((name) => [name, process.env[name]]));
  const cancellation = createCancellation();
  let handle: Awaited<ReturnType<typeof provisionIsolatedDatabase>> | undefined;
  let phase3Root: string | undefined;
  try {
    handle = await provisionIsolatedDatabase("e2e");
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
      await runMigrations(migrationPool);
    } finally {
      await migrationPool.end();
    }
    cancellation.check();
    await seedDevelopmentDatabase();
    cancellation.check();
    const fixturePool = createDatabasePool(databaseConfig("e2e"));
    try { await seedPhase3Identities(fixturePool); } finally { await fixturePool.end(); }
    cancellation.check();
    await cancellation.run("node_modules/next/dist/bin/next", ["build"], { ...commonEnvironment, NODE_ENV: "production" });
    phase3Root = await preparePhase3Application(projectRoot);
    cancellation.check();
    const phase3Environment = {
      ...commonEnvironment, KM_IDENTITY_PROVIDER: "company-sso", KM_COMPANY_SSO_PROVIDER: PHASE3_PROVIDER,
      KM_COMPANY_SSO_TEAM_CREATE_GROUPS: "phase3-creators",
      KM_COMPANY_SSO_ROLLOUT_USER_IDS: phase3PersonaNames.map(phase3UserId).join(","),
      KM_PHASE3_SERVER_PERSONA: "owner",
    };
    cancellation.check();
    await cancellation.run("node_modules/next/dist/bin/next", ["build"], phase3Environment, phase3Root);
    cancellation.check();
    await cancellation.run("node_modules/@playwright/test/cli.js", ["test", ...process.argv.slice(2)], {
      ...commonEnvironment, NODE_ENV: "production", PORT: e2ePort,
      KM_PHASE3_APP_ROOT: phase3Root,
      KM_COMPANY_SSO_ROLLOUT_USER_IDS: phase3Environment.KM_COMPANY_SSO_ROLLOUT_USER_IDS,
    });
  } finally {
    try {
      if (phase3Root) await rm(phase3Root, { recursive: true, force: true });
    } finally {
      try { if (handle) await disposeIsolatedDatabase(handle); }
      finally {
        cancellation.dispose();
        for (const name of environmentNames) {
          const value = previous.get(name);
          if (value === undefined) delete process.env[name]; else process.env[name] = value;
        }
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
