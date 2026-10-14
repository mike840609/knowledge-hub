import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

const root = process.cwd();
function run(settings: string, overrides: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "km-storage-auto-"));
  const fakeMake = path.join(dir, "make");
  writeFileSync(path.join(dir, ".env"), settings);
  writeFileSync(fakeMake, '#!/bin/sh\nprintf "started:%s" "$*"\n', { mode: 0o755 });
  try {
    return execFileSync(process.execPath, [path.join(root, "scripts/storage/local-minio.mjs"), path.join(dir, ".env"), fakeMake], {
      encoding: "utf8", env: { ...process.env, KM_BLOB_DIR: "", KM_BLOB_S3_BUCKET: "", KM_BLOB_S3_ENDPOINT: "", ...overrides },
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const local = { KM_BLOB_S3_BUCKET: "images", KM_BLOB_S3_ENDPOINT: "http://127.0.0.1:9000" };
it("starts local MinIO only for the selected local S3 backend", () => {
  expect(run("", local)).toContain("started:storage-up");
  expect(run("", { ...local, KM_BLOB_S3_ENDPOINT: "http://localhost:9000/" })).toContain("started:storage-up");
});
it("does not start local MinIO for disabled, directory or remote storage", () => {
  for (const settings of [{}, { KM_BLOB_DIR: "/data/images" }, { ...local, KM_BLOB_S3_ENDPOINT: "https://company.example" }] as Record<string, string>[]) {
    expect(run("", settings)).not.toContain("started:");
  }
});
it("reads the environment file and respects explicit empty environment overrides", () => {
  // Delete inherited empty overrides so .env can supply the default; subprocess tests keep secrets out of output.
  const dir = mkdtempSync(path.join(tmpdir(), "km-storage-file-"));
  const fakeMake = path.join(dir, "make");
  const env = { ...process.env };
  delete env.KM_BLOB_DIR; delete env.KM_BLOB_S3_BUCKET; delete env.KM_BLOB_S3_ENDPOINT;
  writeFileSync(path.join(dir, ".env"), 'KM_BLOB_S3_BUCKET="images"\nKM_BLOB_S3_ENDPOINT=http://127.0.0.1:9000\n');
  writeFileSync(fakeMake, '#!/bin/sh\nprintf "started"\n', { mode: 0o755 });
  try {
    const args = [path.join(root, "scripts/storage/local-minio.mjs"), path.join(dir, ".env"), fakeMake];
    expect(execFileSync(process.execPath, args, { encoding: "utf8", env })).toContain("started");
    expect(execFileSync(process.execPath, args, { encoding: "utf8", env: { ...env, KM_BLOB_S3_BUCKET: "" } })).not.toContain("started");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
