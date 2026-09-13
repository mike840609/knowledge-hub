import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { CleanupFolderImportsService } from "@/modules/sources/application/cleanup-folder-imports";

function batchSizeFromArgs(args: string[]): number | undefined {
  const index = args.indexOf("--batch-size");
  if (index === -1) return undefined;
  const parsed = Number(args[index + 1]);
  return Number.isInteger(parsed) ? parsed : undefined;
}

async function main(): Promise<void> {
  const pool = createDatabasePool(databaseConfig("dev"));
  try {
    const service = new CleanupFolderImportsService(new MariaDbUnitOfWork(pool));
    const result = await service.cleanup({ batchSize: batchSizeFromArgs(process.argv.slice(2)) });
    console.log(`Deleted ${result.deleted} expired import snapshot(s).`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
