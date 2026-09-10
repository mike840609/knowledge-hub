import { spawn } from "node:child_process";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { runMigrations } from "../db/migrate";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../db/test-database";
import { seedDevelopmentDatabase } from "../db/seed";

const projectRoot = process.cwd();
const environmentNames = [
  "NODE_ENV", "PORT", "KM_E2E_PORT", "KM_DB_HOST", "KM_DB_PORT", "KM_DB_USER", "KM_DB_PASSWORD", "KM_DB_NAME",
  "KM_E2E_DB_HOST", "KM_E2E_DB_PORT", "KM_E2E_DB_USER", "KM_E2E_DB_PASSWORD", "KM_E2E_DB_NAME",
  "KM_LOCAL_IDENTITY_ENABLED", "KM_LOCAL_ID", "KM_LOCAL_EMP_ID", "KM_LOCAL_NAME", "KM_LOCAL_ORG_CODE",
];

function runCommand(command: string, args: string[], environment: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [command, ...args], { cwd: projectRoot, env: environment, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? `signal ${signal ?? "unknown"}`}.`));
    });
  });
}

async function main(): Promise<void> {
  const previous = new Map(environmentNames.map((name) => [name, process.env[name]]));
  const handle = await provisionIsolatedDatabase("e2e");
  const e2ePort = process.env.KM_E2E_PORT ?? "3101";
  const dbHost = process.env.KM_E2E_DB_HOST ?? process.env.KM_TEST_DB_HOST ?? "127.0.0.1";
  const dbPort = process.env.KM_E2E_DB_PORT ?? process.env.KM_TEST_DB_PORT ?? "3307";
  const dbUser = process.env.KM_E2E_DB_USER ?? process.env.KM_TEST_DB_USER ?? "root";
  const dbPassword = process.env.KM_E2E_DB_PASSWORD ?? process.env.KM_TEST_DB_PASSWORD ?? "hcm_km_root";
  const identity = {
    KM_LOCAL_IDENTITY_ENABLED: "true",
    KM_LOCAL_ID: "0199f000-0000-7000-8000-000000000909",
    KM_LOCAL_EMP_ID: "E2E-0909",
    KM_LOCAL_NAME: "E2E Knowledge User",
    KM_LOCAL_ORG_CODE: "E2E",
  };
  const commonEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
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
  try {
    Object.assign(process.env, commonEnvironment);
    const migrationPool = createDatabasePool(databaseConfig("e2e"));
    try {
      await runMigrations(migrationPool);
    } finally {
      await migrationPool.end();
    }
    await seedDevelopmentDatabase();
    await runCommand("node_modules/next/dist/bin/next", ["build"], { ...commonEnvironment, NODE_ENV: "production" });
    await runCommand("node_modules/@playwright/test/cli.js", ["test"], { ...commonEnvironment, NODE_ENV: "production", PORT: e2ePort });
  } finally {
    await disposeIsolatedDatabase(handle);
    for (const name of environmentNames) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
