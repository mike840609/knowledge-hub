import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, type APIRequestContext } from "@playwright/test";
export function readingFiles(fixture: string) {
  const root = path.resolve("tests/fixtures/import", fixture);
  const files: { path: string; bytes: Buffer }[] = [];
  function walk(dir: string, prefix = "") {
    for (const name of readdirSync(dir).sort()) {
      const rel = prefix ? `${prefix}/${name}` : name,
        full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, rel);
      else files.push({ path: rel, bytes: readFileSync(full) });
    }
  }
  walk(root);
  return files;
}
export async function stageReadingFolder(
  request: APIRequestContext,
  input: {
    workspaceId: string;
    sourceId?: string;
    sourceName: string;
    fixture: string;
  },
) {
  const files = readingFiles(input.fixture),
    manifest = files.map((f, i) => ({
      uploadKey: `m${i}`,
      relativePath: f.path,
      kind: "MARKDOWN",
      size: f.bytes.length,
    }));
  const response = await request.post(
    input.sourceId
      ? `/api/sources/${input.sourceId}/source-imports`
      : `/api/workspaces/${input.workspaceId}/source-imports`,
    {
      data: {
        sourceName: input.sourceName,
        rootName: "Knowledge folder",
        manifest,
      },
    },
  );
  expect(response.ok()).toBe(true);
  const { snapshotId } = await response.json();
  const multipart: Record<
    string,
    string | { name: string; mimeType: string; buffer: Buffer }
  > = {
    entries: JSON.stringify(
      files.map((f, i) => ({ uploadKey: `m${i}`, field: `f${i}` })),
    ),
  };
  files.forEach(
    (f, i) =>
      (multipart[`f${i}`] = {
        name: path.basename(f.path),
        mimeType: "text/markdown",
        buffer: f.bytes,
      }),
  );
  expect(
    (
      await request.post(`/api/source-imports/${snapshotId}/entries`, {
        multipart,
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.post(`/api/source-imports/${snapshotId}/finalize`, {
        data: {},
      })
    ).ok(),
  ).toBe(true);
  return snapshotId as string;
}
