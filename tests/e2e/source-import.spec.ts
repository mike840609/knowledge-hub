import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";

// Phase 2 folder import acceptance. Helpers use the same HTTP contracts as the
// browser launcher (session create, multipart batch upload, finalize, apply)
// plus Preview-page UI assertions; no direct database access.
//
// Fixture note: `basic-v2` keeps `platform/architecture.md` byte-identical to
// `basic-v1/architecture.md` so reconciliation conservatively preserves
// identity and reports MOVED. The v2 body change lands on `guide.md` at a
// stable path (UPDATED), `runbook.md` disappears (ARCHIVED),
// `docs/new-guide.md` appears (ADDED), and the asset bytes change (UPDATED).
// A moved file with changed body would fingerprint differently and must
// surface as ADDED + ARCHIVED instead of a guessed MOVED.
const QUERY_MASTER_WORKSPACE_ID = "0199f100-0000-7000-8000-000000000001";
const FIXTURE_ROOT = path.join(__dirname, "..", "fixtures", "import");
const MARKDOWN_EXTENSION = /\.(?:md|markdown)$/iu;

type FixtureFile = { relativePath: string; bytes: Buffer };

type ImportManifestEntry =
  | { uploadKey: string; relativePath: string; kind: "MARKDOWN"; size: number }
  | {
      uploadKey: string;
      relativePath: string;
      kind: "ASSET";
      size: number;
      contentHash: string;
      mimeType: string | null;
      lastModified: null;
    };

type ImportPreviewSummary = {
  documents: Record<"added" | "updated" | "moved" | "renamed" | "archived" | "restored" | "unchanged", number>;
  assets: Record<"added" | "updated" | "removed" | "unchanged", number>;
};

type ImportPreviewPayload = {
  snapshotId: string;
  hasBlockers: boolean;
  summary: ImportPreviewSummary;
};

function compareRawText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readFixtureTree(fixture: string): { rootName: string; files: FixtureFile[] } {
  const root = path.join(FIXTURE_ROOT, fixture);
  const files: FixtureFile[] = [];
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory).sort(compareRawText)) {
      const full = path.join(directory, entry);
      const relativePath = prefix ? `${prefix}/${entry}` : entry;
      if (statSync(full).isDirectory()) walk(full, relativePath);
      else files.push({ relativePath, bytes: readFileSync(full) });
    }
  };
  walk(root, "");
  files.sort((left, right) => compareRawText(left.relativePath, right.relativePath));
  return { rootName: fixture, files };
}

function toManifest(files: FixtureFile[]): ImportManifestEntry[] {
  return files.map((file, index) => {
    const uploadKey = `e2e-${index}`;
    if (MARKDOWN_EXTENSION.test(file.relativePath)) {
      return { uploadKey, relativePath: file.relativePath, kind: "MARKDOWN", size: file.bytes.length };
    }
    return {
      uploadKey,
      relativePath: file.relativePath,
      kind: "ASSET",
      size: file.bytes.length,
      contentHash: createHash("sha256").update(file.bytes).digest("hex"),
      mimeType: "text/plain",
      lastModified: null,
    };
  });
}

async function uploadMarkdownFiles(request: APIRequestContext, snapshotId: string, files: FixtureFile[]): Promise<void> {
  const markdown = files
    .map((file, index) => ({ file, uploadKey: `e2e-${index}` }))
    .filter((entry) => MARKDOWN_EXTENSION.test(entry.file.relativePath));
  const multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = {
    entries: JSON.stringify(markdown.map((entry, index) => ({ uploadKey: entry.uploadKey, field: `file-${index}` }))),
  };
  markdown.forEach((entry, index) => {
    multipart[`file-${index}`] = { name: path.basename(entry.file.relativePath), mimeType: "text/markdown", buffer: entry.file.bytes };
  });
  const response = await request.post(`/api/source-imports/${snapshotId}/entries`, { multipart });
  expect(response.ok()).toBeTruthy();
}

async function importFolder(
  request: APIRequestContext,
  input: { workspaceId?: string; sourceId?: string; sourceName?: string; fixture: string },
): Promise<{ snapshotId: string; preview: ImportPreviewPayload }> {
  const { rootName, files } = readFixtureTree(input.fixture);
  const manifest = toManifest(files);
  const session = input.sourceId
    ? await request.post(`/api/sources/${input.sourceId}/source-imports`, { data: { rootName, manifest } })
    : await request.post(`/api/workspaces/${input.workspaceId}/source-imports`, {
        data: { sourceName: input.sourceName, rootName, manifest },
      });
  expect(session.ok()).toBeTruthy();
  const { snapshotId } = (await session.json()) as { snapshotId: string };
  await uploadMarkdownFiles(request, snapshotId, files);
  const finalized = await request.post(`/api/source-imports/${snapshotId}/finalize`, { data: {} });
  expect(finalized.ok()).toBeTruthy();
  const preview = (await finalized.json()) as ImportPreviewPayload;
  return { snapshotId, preview };
}

async function applySnapshot(request: APIRequestContext, snapshotId: string): Promise<{ sourceId: string }> {
  const response = await request.post(`/api/source-imports/${snapshotId}/apply`, { data: {} });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { sourceId: string };
}

test("imports basic-v1 through the directory input and applies the preview", async ({ page }) => {
  await page.goto("/knowledge");
  await page.getByLabel("Choose a workspace").selectOption({ label: "Query Master" });
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/\/knowledge\?workspaceId=/);

  await page.locator("#import-source-name").fill("E2E Folder Import");
  await page.locator("#import-folder").setInputFiles(path.join(FIXTURE_ROOT, "basic-v1"));

  await expect(page).toHaveURL(/\/knowledge\/imports\/[0-9a-f-]+/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Import preview" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm and apply" })).toBeEnabled();
  await page.getByRole("button", { name: "Confirm and apply" }).click();

  await expect(page).toHaveURL(/\/knowledge\?workspaceId=.*&sourceId=.*/, { timeout: 30_000 });
  const tree = page.getByRole("region", { name: "Your source tree" });
  await expect(tree.getByRole("link", { name: "Fixture Overview", exact: true })).toBeVisible();
  await expect(tree.getByRole("link", { name: "Architecture", exact: true })).toBeVisible();
  await expect(tree.getByRole("link", { name: "Runbook", exact: true })).toBeVisible();
  await expect(tree.getByRole("link", { name: "Guide", exact: true })).toBeVisible();
});

test("syncs v1 to v2 with moved, updated, archived, and added labels", async ({ page, request }) => {
  const first = await importFolder(request, {
    workspaceId: QUERY_MASTER_WORKSPACE_ID,
    sourceName: "E2E Import Sync",
    fixture: "basic-v1",
  });
  const { sourceId } = await applySnapshot(request, first.snapshotId);

  const second = await importFolder(request, { sourceId, fixture: "basic-v2" });
  expect(second.preview.summary.documents.moved).toBeGreaterThanOrEqual(1);
  expect(second.preview.summary.documents.updated).toBeGreaterThanOrEqual(1);
  expect(second.preview.summary.documents.archived).toBeGreaterThanOrEqual(1);
  expect(second.preview.summary.documents.added).toBeGreaterThanOrEqual(1);
  expect(second.preview.summary.assets.updated).toBe(1);

  await page.goto(`/knowledge/imports/${second.snapshotId}`);
  await expect(page.getByRole("heading", { name: "Import preview" })).toBeVisible();
  await expect(page.getByText("platform/architecture.md")).toBeVisible();
  await expect(page.getByText("docs/new-guide.md")).toBeVisible();
  await page.getByRole("button", { name: "Moved", exact: true }).click();
  await expect(page.getByText("platform/architecture.md")).toBeVisible();

  await page.getByRole("button", { name: "Confirm and apply" }).click();
  await expect(page).toHaveURL(new RegExp(`/knowledge\\?workspaceId=.*&sourceId=${sourceId}`), { timeout: 30_000 });
  const tree = page.getByRole("region", { name: "Your source tree" });
  await expect(tree.getByRole("link", { name: "Architecture", exact: true })).toBeVisible();
  await expect(tree.getByRole("link", { name: "New Guide", exact: true })).toBeVisible();
  await expect(tree.getByText("Runbook", { exact: true })).toHaveCount(0);
});

test("shows the malformed frontmatter blocker and disables apply", async ({ page, request }) => {
  const bad = await importFolder(request, {
    workspaceId: QUERY_MASTER_WORKSPACE_ID,
    sourceName: "E2E Malformed Import",
    fixture: "malformed-frontmatter",
  });
  expect(bad.preview.hasBlockers).toBe(true);

  await page.goto(`/knowledge/imports/${bad.snapshotId}`);
  await expect(page.getByRole("heading", { name: "Import preview" })).toBeVisible();
  await expect(page.getByText("INVALID_FRONTMATTER")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm and apply" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /force/i })).toHaveCount(0);
});

test("stale preview loses to the second preview with no force apply", async ({ page, request }) => {
  const first = await importFolder(request, {
    workspaceId: QUERY_MASTER_WORKSPACE_ID,
    sourceName: "E2E Stale Import",
    fixture: "basic-v1",
  });
  const { sourceId } = await applySnapshot(request, first.snapshotId);

  const older = await importFolder(request, { sourceId, fixture: "basic-v2" });
  const newer = await importFolder(request, { sourceId, fixture: "basic-v2" });
  await applySnapshot(request, newer.snapshotId);

  const olderApply = await request.post(`/api/source-imports/${older.snapshotId}/apply`, { data: {} });
  expect(olderApply.status()).toBe(409);
  expect(((await olderApply.json()) as { error: { code: string } }).error.code).toBe("SOURCE_VERSION_CONFLICT");

  await page.goto(`/knowledge/imports/${older.snapshotId}`);
  await expect(page.getByText("There is no Force Apply")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm and apply" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Choose folder again" })).toBeVisible();
});
