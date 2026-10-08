import "dotenv/config";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { BlobMaintenanceService } from "@/modules/sources/application/blob-maintenance";
import { configuredBlobStore } from "@/server/blob-store";

async function main(): Promise<void> {
  const [command, flag] = process.argv.slice(2);
  const blobs = configuredBlobStore();
  if (!blobs) throw new Error("KM_BLOB_DIR is not set: this server stores no images.");
  const pool = createDatabasePool(databaseConfig("dev"));
  try {
    const maintenance = new BlobMaintenanceService(new MariaDbUnitOfWork(pool), blobs);
    if (command === "gc") {
      console.info("Removed unreferenced blobs:", (await maintenance.gc()).removed);
    } else if (command === "verify") {
      const { missing } = await maintenance.verify({ repair: flag === "--repair" });
      for (const item of missing) console.info(`missing\t${item.sourceId}\t${item.sourcePath}`);
      console.info(`${missing.length} stored image(s) missing${flag === "--repair" ? "; each will be uploaded again on its source's next sync" : ""}.`);
      if (missing.length > 0 && flag !== "--repair") process.exitCode = 1;
    } else {
      throw new Error("Usage: blobs.ts gc | verify [--repair]");
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
