import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";

// Read at execution time: bootstrap may have just created .env. Exported
// variables win, including empty strings that explicitly turn S3 storage off.
let file = {};
try { file = parse(readFileSync(process.argv[2] || ".env")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const settings = { ...file, ...process.env };
const endpoint = settings.KM_BLOB_S3_ENDPOINT?.replace(/\/+$/, "");
const local = !settings.KM_BLOB_DIR && !!settings.KM_BLOB_S3_BUCKET
  && ["http://127.0.0.1:9000", "http://localhost:9000"].includes(endpoint);
if (local) {
  const result = spawnSync(process.argv[3] || "make", ["storage-up"], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  console.info("Local MinIO skipped: image storage is disabled, a directory, or an external S3 service.");
}
