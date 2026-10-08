import "dotenv/config";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { BlobMaintenanceService } from "@/modules/sources/application/blob-maintenance";
import { S3BlobStore } from "@/infrastructure/storage/s3-blob-store";
import { configuredBlobStore } from "@/server/blob-store";

async function main(): Promise<void> {
  const [command, flag] = process.argv.slice(2);
  const blobs = configuredBlobStore();
  if (!blobs) throw new Error("Neither KM_BLOB_S3_BUCKET nor KM_BLOB_DIR is set: this server stores no images.");
  if (command === "create-bucket") {
    if (!(blobs instanceof S3BlobStore)) throw new Error("create-bucket needs KM_BLOB_S3_BUCKET; a directory store has no bucket.");
    await blobs.createBucket();
    console.info(`Bucket ${process.env.KM_BLOB_S3_BUCKET} is ready.`);
    return;
  }
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
      throw new Error("Usage: blobs.ts gc | verify [--repair] | create-bucket");
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
