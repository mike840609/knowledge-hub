import { spawn } from "node:child_process";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { runMigrations } from "../db/migrate";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../db/test-database";

function runVitest(): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.integration.config.ts"], { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function main(): Promise<void> {
  const handle = await provisionIsolatedDatabase("test");
  const previous = process.env.KM_TEST_DB_NAME;
  process.env.KM_TEST_DB_NAME = handle.databaseName;
  try {
    const pool = createDatabasePool(databaseConfig("test"));
    try { await runMigrations(pool); } finally { await pool.end(); }
    const code = await runVitest();
    if (code !== 0) process.exitCode = code;
  } finally {
    if (previous === undefined) delete process.env.KM_TEST_DB_NAME; else process.env.KM_TEST_DB_NAME = previous;
    await disposeIsolatedDatabase(handle);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
