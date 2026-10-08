# Folder Sync Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Images in a synced folder are uploaded at import, kept on a mounted volume, and shown to signed-in readers and on shared pages, each through an endpoint that authorizes every request.

**Architecture:** A content-addressed `BlobStore` port with a filesystem adapter holds the bytes. Import proves possession of each image by streaming it through a hash check before Finalize will accept the snapshot; the proof and the "stored" flag live in columns that already exist, so there is no migration. Reading resolves an image path at request time against the document's own source, behind the document's read check for signed-in readers and behind the share link's validity check plus "this revision draws it" for shared pages.

**Tech Stack:** Next.js 15 route handlers (Web streams), Node `fs`/`stream`, MariaDB, unified/remark (`src/shared/markdown/parse.ts`), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-folder-sync-images-design.md` (read it first; §12 lists where this plan's mechanics differ from the first draft and why).

## Global Constraints

- Image types, decided by extension only, case-insensitive: `png jpg jpeg gif webp avif svg`. The browser's MIME hint is never trusted.
- `KM_BLOB_DIR` unset: the feature is off and every existing behaviour is unchanged. Set but not an existing writable directory: the server refuses to start.
- A blob key is the lowercase hex SHA-256 of the content. No user-supplied name reaches the filesystem.
- The server never skips an image upload because the blob exists. Bytes are required unless **the same source** already stores that hash.
- Every image response carries: `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`, `Content-Disposition: inline`.
- Shared pages: the token grants the images the document's **current** revision draws, nothing else. Every failure is the same 404.
- `src/modules/**` may not import `next`, `react`, `mariadb`, `infrastructure/`, and `src/modules/knowledge/**` may not import `@/modules/sources/**`. `make lint` enforces this.
- Existing limits apply unchanged: `KM_IMPORT_MAX_ASSET_FILE_BYTES` (64 MiB), `KM_IMPORT_MAX_ASSET_TOTAL_BYTES` (512 MiB).
- On this machine `npm`/`npx` are shadowed in non-interactive shells. Run `export PATH=/Users/chuntsai/.nvm/versions/node/v24.6.0/bin:$PATH` first, call `./node_modules/.bin/vitest` directly, and print exit codes (`; echo "EXIT=$?"`) instead of piping into `tail`.
- Commit messages end with the session trailer the harness supplies.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/shared/markdown/image-path.ts` (new) | Extension → content type; resolve an image `src` against a document path |
| `src/shared/markdown/image-sources.ts` (new) | The image sources a Markdown body draws |
| `src/modules/sources/ports/blob-store.ts` (new) | `BlobStore` port, `BlobMismatchError` |
| `src/infrastructure/storage/filesystem-blob-store.ts` (new) | Filesystem adapter |
| `src/server/blob-store.ts` (new) | Read `KM_BLOB_DIR`, fail fast, memoise the store |
| `src/instrumentation.ts` (new) | Run the fail-fast check at server start |
| `src/modules/sources/domain/stored-image.ts` (new) | `isStoredImage`, `needsImageBytes` |
| `src/modules/sources/application/create-folder-import.ts` | Stage images as `PENDING`; return `assetUploads` |
| `src/modules/sources/application/upload-folder-import-asset.ts` (new) | Verify and store one image |
| `src/app/api/source-imports/[snapshotId]/asset/route.ts` (new) | `PUT` one image |
| `src/modules/sources/application/finalize-folder-import.ts` | Require every entry received; mark `metadata.stored` |
| `src/modules/knowledge/ports/source-policy.ts`, `src/infrastructure/database/mariadb/repositories/source-policy.ts` | `findStoredImage` |
| `src/modules/knowledge/application/document-image-service.ts` (new) | Signed-in image lookup behind the document read check |
| `src/server/document-images.ts` (new) | Build the image `Response` |
| `src/app/api/documents/[documentId]/asset/route.ts` (new) | `GET` an image for a signed-in reader |
| `src/components/knowledge/markdown-image-base.tsx` (new), `markdown-image.tsx`, `document-viewer.tsx` | Rewrite relative `src` to the endpoint |
| `src/modules/knowledge/application/document-share-service.ts`, `src/server/share-read.ts`, `src/app/s/[token]/asset/route.ts` (new), `src/app/s/[token]/page.tsx` | Shared-page images |
| `src/components/imports/folder-import-form.tsx` | Upload the images the server asked for |
| `src/modules/sources/application/blob-maintenance.ts` (new), `scripts/storage/blobs.ts` (new) | `gc`, `verify` |
| `next.config.ts` | Header rules for the two image routes |

---

### Task 1: Image path and image source helpers

**Files:**
- Create: `src/shared/markdown/image-path.ts`, `src/shared/markdown/image-sources.ts`
- Test: `tests/unit/image-path.test.ts`, `tests/unit/image-sources.test.ts`

**Interfaces:**
- Produces: `imageContentType(path: string): string | null`, `resolveImagePath(documentPath: string, src: string): string | null`, `extractImageSources(markdown: string): string[]`

- [ ] **Step 1: Write the failing tests**

`tests/unit/image-path.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { imageContentType, resolveImagePath } from "@/shared/markdown/image-path";

describe("imageContentType", () => {
  it("knows the seven image extensions, case-insensitively", () => {
    expect(imageContentType("a/b.png")).toBe("image/png");
    expect(imageContentType("a.JPG")).toBe("image/jpeg");
    expect(imageContentType("a.jpeg")).toBe("image/jpeg");
    expect(imageContentType("a.gif")).toBe("image/gif");
    expect(imageContentType("a.webp")).toBe("image/webp");
    expect(imageContentType("a.avif")).toBe("image/avif");
    expect(imageContentType("a.svg")).toBe("image/svg+xml");
  });
  it("refuses everything else, including names that are object keys", () => {
    for (const path of ["a.pdf", "a.html", "a.png.exe", "png", "a.", "a.constructor", "a.toString", ""]) expect(imageContentType(path)).toBeNull();
  });
});

describe("resolveImagePath", () => {
  it("resolves against the document's folder", () => {
    expect(resolveImagePath("guides/setup.md", "img/a.png")).toBe("guides/img/a.png");
    expect(resolveImagePath("guides/setup.md", "./a.png")).toBe("guides/a.png");
    expect(resolveImagePath("guides/deep/setup.md", "../a.png")).toBe("guides/a.png");
    expect(resolveImagePath("setup.md", "a.png")).toBe("a.png");
  });
  it("treats a leading slash as the source root", () => {
    expect(resolveImagePath("guides/setup.md", "/assets/a.png")).toBe("assets/a.png");
  });
  it("decodes percent-encoding and drops query and fragment", () => {
    expect(resolveImagePath("a.md", "my%20image.png?v=2#x")).toBe("my image.png");
  });
  it("returns null for anything that leaves the root or is not a relative path", () => {
    for (const src of ["../../a.png", "/../a.png", "a/../../../b.png", "https://x.test/a.png", "//x.test/a.png", "data:image/png;base64,AA", "a\\b.png", "%E0%A4%A", "a%00.png", "", "   ", "?x", "."]) {
      expect(resolveImagePath("guides/setup.md", src), src).toBeNull();
    }
    expect(resolveImagePath("setup.md", "../a.png")).toBeNull();
  });
});
```

`tests/unit/image-sources.test.ts`:

```ts
import { expect, it } from "vitest";
import { extractImageSources } from "@/shared/markdown/image-sources";

it("lists inline and reference-style images once each, in the order written", () => {
  const markdown = "![a](img/a.png)\n\n![b][ref] and ![a again](img/a.png)\n\n[ref]: ../b.svg \"title\"\n";
  expect(extractImageSources(markdown)).toEqual(["img/a.png", "../b.svg"]);
});
it("ignores links, code, Obsidian embeds and an unresolved reference", () => {
  const markdown = "[link](a.png)\n\n`![x](code.png)`\n\n~~~\n![y](fenced.png)\n~~~\n\n![[embed.png]]\n\n![z][missing]\n";
  expect(extractImageSources(markdown)).toEqual([]);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts tests/unit/image-path.test.ts tests/unit/image-sources.test.ts; echo "EXIT=$?"`
Expected: both files fail to import their module; `EXIT=1`.

- [ ] **Step 3: Implement**

`src/shared/markdown/image-path.ts`:

```ts
// A Map, not an object: "constructor" must not look like a known extension.
const CONTENT_TYPES = new Map([
  ["png", "image/png"], ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["gif", "image/gif"],
  ["webp", "image/webp"], ["avif", "image/avif"], ["svg", "image/svg+xml"],
]);

/** The content type an image path is served with; null when the path is not an image we store. */
export function imageContentType(path: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  return match ? CONTENT_TYPES.get(match[1].toLowerCase()) ?? null : null;
}

/**
 * Where an image `src`, as a document writes it, points inside the source.
 * A leading `/` is the source root. Null for a URL, and for a path that leaves the root.
 */
export function resolveImagePath(documentPath: string, src: string): string | null {
  const bare = src.trim().split(/[?#]/, 1)[0];
  if (!bare || /^[a-z][a-z0-9+.-]*:/i.test(bare) || bare.startsWith("//") || bare.includes("\\")) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(bare); } catch { return null; }
  if (/[\u0000-\u001f\u007f]/u.test(decoded)) return null;
  const segments = decoded.startsWith("/") ? [] : documentPath.split("/").slice(0, -1);
  for (const segment of decoded.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") { if (segments.length === 0) return null; segments.pop(); continue; }
    segments.push(segment);
  }
  // "." names the document's folder, which is not a file.
  const namesFile = decoded.split("/").some((segment) => segment !== "" && segment !== "." && segment !== "..");
  return namesFile ? segments.join("/") : null;
}
```

`src/shared/markdown/image-sources.ts`:

```ts
import type { Definition, Image, ImageReference } from "mdast";
import { visit } from "unist-util-visit";
import { parseMarkdown } from "./parse";

/** Every image source a Markdown body draws, parsed as the renderer parses it. */
export function extractImageSources(markdown: string): string[] {
  const tree = parseMarkdown(markdown);
  const definitions = new Map<string, string>();
  visit(tree, "definition", (node: Definition) => { definitions.set(node.identifier, node.url); });
  const sources = new Set<string>();
  visit(tree, (node) => {
    if (node.type === "image") sources.add((node as Image).url);
    if (node.type === "imageReference") {
      const url = definitions.get((node as ImageReference).identifier);
      if (url) sources.add(url);
    }
  });
  return [...sources].filter(Boolean);
}
```

- [ ] **Step 4: Run them and see them pass**

Run: same command as Step 2. Expected: all pass, `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/markdown/image-path.ts src/shared/markdown/image-sources.ts tests/unit/image-path.test.ts tests/unit/image-sources.test.ts
git commit -m "feat(images): resolve image paths and list the images a document draws"
```

---

### Task 2: BlobStore port, filesystem adapter, configuration

**Files:**
- Create: `src/modules/sources/ports/blob-store.ts`, `src/infrastructure/storage/filesystem-blob-store.ts`, `src/server/blob-store.ts`, `src/instrumentation.ts`
- Modify: `.env.example`
- Test: `tests/unit/filesystem-blob-store.test.ts`, `tests/unit/blob-store-config.test.ts`

**Interfaces:**
- Produces:
  - `type BlobBody = ReadableStream<Uint8Array>`
  - `interface BlobStore { put(sha256: string, body: BlobBody, expectedSize: number): Promise<void>; open(sha256: string): Promise<{ body: BlobBody; size: number } | null>; has(sha256: string): Promise<boolean>; remove(sha256: string): Promise<void>; list(): AsyncIterable<{ sha256: string; modifiedAt: Date }> }`
  - `class BlobMismatchError extends Error`
  - `class FilesystemBlobStore implements BlobStore` with `constructor(root: string)`
  - `configuredBlobStore(): BlobStore | null` in `src/server/blob-store.ts`

- [ ] **Step 1: Write the failing tests**

`tests/unit/filesystem-blob-store.test.ts`:

```ts
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { FilesystemBlobStore } from "@/infrastructure/storage/filesystem-blob-store";
import { BlobMismatchError } from "@/modules/sources/ports/blob-store";

const bytes = new TextEncoder().encode("not really a png");
const sha = createHash("sha256").update(bytes).digest("hex");
const body = (data: Uint8Array = bytes) => new Blob([data]).stream() as ReadableStream<Uint8Array>;
const text = async (stream: ReadableStream<Uint8Array>) => new Response(stream).text();
let root: string, store: FilesystemBlobStore;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "km-blob-")); store = new FilesystemBlobStore(root); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it("stores bytes under their hash and reads them back", async () => {
  expect(await store.has(sha)).toBe(false);
  expect(await store.open(sha)).toBeNull();
  await store.put(sha, body(), bytes.byteLength);
  expect(await store.has(sha)).toBe(true);
  const opened = await store.open(sha);
  expect(opened!.size).toBe(bytes.byteLength);
  expect(await text(opened!.body)).toBe("not really a png");
  expect(await readdir(path.join(root, "sha256", sha.slice(0, 2), sha.slice(2, 4)))).toEqual([sha]);
});
it("accepts the same bytes twice", async () => {
  await store.put(sha, body(), bytes.byteLength);
  await store.put(sha, body(), bytes.byteLength);
  expect(await text((await store.open(sha))!.body)).toBe("not really a png");
});
it("rejects bytes that do not match the declared hash or size, and leaves nothing behind", async () => {
  const other = new TextEncoder().encode("something else!!");
  await expect(store.put(sha, body(other), other.byteLength)).rejects.toBeInstanceOf(BlobMismatchError);
  await expect(store.put(sha, body(), bytes.byteLength + 1)).rejects.toBeInstanceOf(BlobMismatchError);
  await expect(store.put(sha, body(), bytes.byteLength - 1)).rejects.toBeInstanceOf(BlobMismatchError);
  expect(await store.has(sha)).toBe(false);
  expect(await readdir(path.join(root, "tmp"))).toEqual([]);
});
it("refuses a key that is not a lowercase SHA-256", async () => {
  for (const key of ["../../etc/passwd", sha.toUpperCase(), sha.slice(1), ""]) {
    await expect(store.put(key, body(), bytes.byteLength)).rejects.toThrow("SHA-256");
    await expect(store.has(key)).rejects.toThrow("SHA-256");
  }
});
it("lists what it holds with modification times, and removes", async () => {
  await store.put(sha, body(), bytes.byteLength);
  const old = new Date("2026-01-01T00:00:00Z");
  await utimes(path.join(root, "sha256", sha.slice(0, 2), sha.slice(2, 4), sha), old, old);
  const listed = [];
  for await (const blob of store.list()) listed.push(blob);
  expect(listed).toEqual([{ sha256: sha, modifiedAt: old }]);
  await store.remove(sha);
  await store.remove(sha);
  expect(await store.has(sha)).toBe(false);
});
it("lists nothing from an empty root", async () => {
  const listed = [];
  for await (const blob of store.list()) listed.push(blob);
  expect(listed).toEqual([]);
});
```

`tests/unit/blob-store-config.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
const load = async () => (await import("@/server/blob-store")).configuredBlobStore;

it("is off when KM_BLOB_DIR is unset or empty", async () => {
  vi.stubEnv("KM_BLOB_DIR", "");
  expect((await load())()).toBeNull();
});
it("returns one store for a writable directory", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "km-blob-config-"));
  vi.stubEnv("KM_BLOB_DIR", dir);
  const configured = await load();
  expect(configured()).not.toBeNull();
  expect(configured()).toBe(configured());
  await rm(dir, { recursive: true, force: true });
});
it("refuses a path that is missing or is a file, naming it", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "km-blob-config-"));
  vi.stubEnv("KM_BLOB_DIR", path.join(dir, "absent"));
  await expect(load().then((configured) => configured())).rejects.toThrow(/KM_BLOB_DIR.*absent/);
  vi.resetModules();
  await writeFile(path.join(dir, "file"), "x");
  vi.stubEnv("KM_BLOB_DIR", path.join(dir, "file"));
  await expect(load().then((configured) => configured())).rejects.toThrow(/KM_BLOB_DIR/);
  await rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts tests/unit/filesystem-blob-store.test.ts tests/unit/blob-store-config.test.ts; echo "EXIT=$?"`
Expected: modules not found, `EXIT=1`.

- [ ] **Step 3: Implement the port**

`src/modules/sources/ports/blob-store.ts`:

```ts
export type BlobBody = ReadableStream<Uint8Array>;

/** Bytes did not match the hash or size they were declared with. */
export class BlobMismatchError extends Error {
  constructor() { super("Blob bytes do not match the declared hash and size."); this.name = "BlobMismatchError"; }
}

/**
 * Content-addressed storage for image bytes. The key is the lowercase hex
 * SHA-256 of the content, so content under a key never changes.
 */
export interface BlobStore {
  /** Always reads and verifies `body`, even when the key exists: possession is the caller's to prove. */
  put(sha256: string, body: BlobBody, expectedSize: number): Promise<void>;
  open(sha256: string): Promise<{ body: BlobBody; size: number } | null>;
  has(sha256: string): Promise<boolean>;
  remove(sha256: string): Promise<void>;
  list(): AsyncIterable<{ sha256: string; modifiedAt: Date }>;
}
```

- [ ] **Step 4: Implement the adapter**

`src/infrastructure/storage/filesystem-blob-store.ts`:

```ts
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BlobMismatchError, type BlobBody, type BlobStore } from "@/modules/sources/ports/blob-store";

const SHA256 = /^[0-9a-f]{64}$/;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

export class FilesystemBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  private file(sha256: string): string {
    if (!SHA256.test(sha256)) throw new Error("A blob key is a lowercase hex SHA-256.");
    return path.join(this.root, "sha256", sha256.slice(0, 2), sha256.slice(2, 4), sha256);
  }

  async put(sha256: string, body: BlobBody, expectedSize: number): Promise<void> {
    const target = this.file(sha256);
    const temporary = path.join(this.root, "tmp", randomUUID());
    await mkdir(path.dirname(temporary), { recursive: true });
    const hash = createHash("sha256");
    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        size += chunk.length;
        if (size > expectedSize) return done(new BlobMismatchError());
        hash.update(chunk);
        done(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(body as never), meter, createWriteStream(temporary, { flags: "wx" }));
      if (size !== expectedSize || hash.digest("hex") !== sha256) throw new BlobMismatchError();
      // Flushed before it gets its real name: a crash leaves a temp file, never a short image.
      const handle = await open(temporary, "r+");
      try { await handle.sync(); } finally { await handle.close(); }
      await mkdir(path.dirname(target), { recursive: true });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async open(sha256: string): Promise<{ body: BlobBody; size: number } | null> {
    const file = this.file(sha256);
    try {
      const { size } = await stat(file);
      return { body: Readable.toWeb(createReadStream(file)) as unknown as BlobBody, size };
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }

  async has(sha256: string): Promise<boolean> {
    try { return (await stat(this.file(sha256))).isFile(); } catch (error) { if (missing(error)) return false; throw error; }
  }

  async remove(sha256: string): Promise<void> {
    await rm(this.file(sha256), { force: true });
  }

  async *list(): AsyncIterable<{ sha256: string; modifiedAt: Date }> {
    const names = async (dir: string) => { try { return (await readdir(dir)).sort(); } catch (error) { if (missing(error)) return []; throw error; } };
    const base = path.join(this.root, "sha256");
    for (const first of await names(base)) {
      for (const second of await names(path.join(base, first))) {
        for (const name of await names(path.join(base, first, second))) {
          if (!SHA256.test(name)) continue;
          try { yield { sha256: name, modifiedAt: (await stat(path.join(base, first, second, name))).mtime }; } catch (error) { if (!missing(error)) throw error; }
        }
      }
    }
  }
}
```

- [ ] **Step 5: Implement configuration and the start-up check**

`src/server/blob-store.ts`:

```ts
import { accessSync, constants, statSync } from "node:fs";
import { FilesystemBlobStore } from "@/infrastructure/storage/filesystem-blob-store";
import type { BlobStore } from "@/modules/sources/ports/blob-store";

let store: BlobStore | null | undefined;

/**
 * The image store, or null when `KM_BLOB_DIR` is unset and images stay
 * reference-only. The directory is never created here: a path that does not
 * exist usually means the volume was not mounted, and creating it would put
 * images in a container layer that the next deploy throws away.
 */
export function configuredBlobStore(): BlobStore | null {
  if (store !== undefined) return store;
  const dir = process.env.KM_BLOB_DIR;
  if (!dir) return (store = null);
  try {
    if (!statSync(dir).isDirectory()) throw new Error("not a directory");
    accessSync(dir, constants.W_OK);
  } catch {
    throw new Error(`KM_BLOB_DIR (${dir}) must be an existing, writable directory. Mount the image volume there, or unset KM_BLOB_DIR to keep images as references only.`);
  }
  return (store = new FilesystemBlobStore(dir));
}
```

`src/instrumentation.ts`:

```ts
/** Runs once when the server starts: a misconfigured image volume stops the server, not the first upload. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  (await import("@/server/blob-store")).configuredBlobStore();
}
```

Append to `.env.example`, after the `KM_IMPORT_*` block:

```bash
# Where synced folders' images are stored. Unset: images stay reference-only.
# Must be an existing, writable directory on a persistent volume; the server refuses to start otherwise.
# KM_BLOB_DIR=/var/lib/knowledge-hub/blobs
```

- [ ] **Step 6: Run the tests and the build**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts tests/unit/filesystem-blob-store.test.ts tests/unit/blob-store-config.test.ts; echo "EXIT=$?"`
Expected: `EXIT=0`.
Run: `make typecheck lint build > /tmp/km-build.log 2>&1; echo "EXIT=$?"` (use `$CLAUDE_JOB_DIR/tmp` in place of `/tmp` when it is set).
Expected: `EXIT=0`. The build proves `src/instrumentation.ts` compiles under the patched Next.

- [ ] **Step 7: Commit**

```bash
git add src/modules/sources/ports/blob-store.ts src/infrastructure/storage src/server/blob-store.ts src/instrumentation.ts .env.example tests/unit/filesystem-blob-store.test.ts tests/unit/blob-store-config.test.ts
git commit -m "feat(images): content-addressed blob store on a mounted volume"
```

---

### Task 3: Stage images at import and accept their bytes

**Files:**
- Create: `src/modules/sources/domain/stored-image.ts`, `src/modules/sources/application/upload-folder-import-asset.ts`, `src/app/api/source-imports/[snapshotId]/asset/route.ts`
- Modify: `src/modules/sources/application/create-folder-import.ts` (`stagingEntries`, `buildSnapshot`, `createBound`, `CreateImportResult`, `Options`), `src/modules/sources/ports/import-snapshot-entry-repository.ts`, `src/infrastructure/database/mariadb/repositories/import-snapshot-entries.ts`, `src/server/composition.ts`, `src/server/source-imports.ts`
- Test: `tests/unit/stored-image.test.ts`, `tests/integration/folder-images-import.test.ts`, `tests/fixtures/folder-images.ts` (new)

**Interfaces:**
- Consumes: `imageContentType` (Task 1); `BlobStore`, `BlobBody`, `BlobMismatchError`, `configuredBlobStore` (Task 2)
- Produces:
  - `isStoredImage(asset: { sourcePath: string; contentHash: string | null; metadata: Record<string, unknown> }): boolean`
  - `needsImageBytes(entry: { relativePath: string; size: number; contentHash: string }, storedHashes: ReadonlySet<string>): boolean`
  - `CreateImportResult` gains `assetUploads: string[]` (upload keys)
  - `CreateFolderImportService` option `storeImages?: boolean`
  - `ImportSnapshotEntryRepository.markAssetReceived(entryId: string, contentHash: string): Promise<void>`
  - `UploadFolderImportAssetService.upload(caller, { snapshotId, uploadKey, body, contentLength }): Promise<{ accepted: boolean }>`
  - `PUT /api/source-imports/:snapshotId/asset?uploadKey=<key>` with the file as the raw body
  - `buildApplicationServices(pool, { blobStore?: BlobStore | null })`; `applicationServices().blobs: BlobStore | null`; `imports.uploadAsset: UploadFolderImportAssetService | null`
  - Test fixture `prepareImageImport` (see Step 1)

**How the proof is recorded (no migration):** an image entry is staged `uploadStatus: "PENDING"` with `sourceFileHash: null`. A verified upload sets `upload_status='RECEIVED'` and `source_file_hash = <the asset hash>`. An image the same source already stores is staged `RECEIVED` with `sourceFileHash` already set. So "bytes proven for this snapshot" is exactly `sourceFileHash === assetContentHash`, and non-image assets keep `sourceFileHash: null` as today.

- [ ] **Step 1: Write the fixture and the failing tests**

`tests/unit/stored-image.test.ts`:

```ts
import { expect, it } from "vitest";
import { isStoredImage, needsImageBytes } from "@/modules/sources/domain/stored-image";

const hash = "a".repeat(64);
it("an image is stored only with a hash, the stored flag and an image extension", () => {
  expect(isStoredImage({ sourcePath: "a.png", contentHash: hash, metadata: { stored: true } })).toBe(true);
  expect(isStoredImage({ sourcePath: "a.png", contentHash: hash, metadata: {} })).toBe(false);
  expect(isStoredImage({ sourcePath: "a.png", contentHash: hash, metadata: { stored: "true" } })).toBe(false);
  expect(isStoredImage({ sourcePath: "a.png", contentHash: null, metadata: { stored: true } })).toBe(false);
  expect(isStoredImage({ sourcePath: "a.pdf", contentHash: hash, metadata: { stored: true } })).toBe(false);
});
it("bytes are needed for a non-empty image this source does not already store", () => {
  const none = new Set<string>();
  expect(needsImageBytes({ relativePath: "a.png", size: 10, contentHash: hash }, none)).toBe(true);
  expect(needsImageBytes({ relativePath: "a.png", size: 10, contentHash: hash }, new Set([hash]))).toBe(false);
  expect(needsImageBytes({ relativePath: "a.png", size: 0, contentHash: hash }, none)).toBe(false);
  expect(needsImageBytes({ relativePath: "a.pdf", size: 10, contentHash: hash }, none)).toBe(false);
});
```

`tests/fixtures/folder-images.ts`:

```ts
import { createHash } from "node:crypto";
import type { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { CreateFolderImportService } from "@/modules/sources/application/create-folder-import";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { UploadFolderImportAssetService } from "@/modules/sources/application/upload-folder-import-asset";
import { UploadFolderImportEntriesService } from "@/modules/sources/application/upload-folder-import-entries";
import type { BlobStore } from "@/modules/sources/ports/blob-store";
import { fixtureCaller } from "./knowledge";

export type FixtureFile = { path: string; text: string } | { path: string; bytes: Uint8Array };
export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const png = (seed: string) => new TextEncoder().encode(`png:${seed}`);
export const stream = (bytes: Uint8Array) => new Blob([bytes]).stream() as ReadableStream<Uint8Array>;

/** Creates a snapshot. `upload: false` stops before any image is sent. Returns the snapshot and what the server asked for. */
export async function stageImageImport(uow: MariaDbUnitOfWork, blobs: BlobStore | null, workspaceId: string, sourceId: string | null, files: FixtureFile[], caller = fixtureCaller()) {
  const entries = files.map((file, index) => ({ key: `f${index}`, path: file.path, bytes: "text" in file ? new TextEncoder().encode(file.text) : file.bytes, markdown: "text" in file }));
  const manifest = entries.map((entry) => entry.markdown
    ? { uploadKey: entry.key, relativePath: entry.path, kind: "MARKDOWN" as const, size: entry.bytes.byteLength }
    : { uploadKey: entry.key, relativePath: entry.path, kind: "ASSET" as const, size: entry.bytes.byteLength, contentHash: sha256(entry.bytes), mimeType: null, lastModified: null });
  const create = new CreateFolderImportService(uow, { storeImages: blobs !== null });
  const session = sourceId
    ? await create.createResync(caller, { sourceId, rootName: "images", manifest })
    : await create.createInitial(caller, { workspaceId, sourceName: "Images", rootName: "images", manifest });
  const markdown = entries.filter((entry) => entry.markdown);
  if (markdown.length) await new UploadFolderImportEntriesService(uow).upload(caller, { snapshotId: session.snapshotId, entries: markdown.map((entry) => ({ uploadKey: entry.key, bytes: entry.bytes })) });
  return { snapshotId: session.snapshotId, assetUploads: session.assetUploads, entries };
}

export async function prepareImageImport(uow: MariaDbUnitOfWork, blobs: BlobStore | null, workspaceId: string, sourceId: string | null, files: FixtureFile[]) {
  const staged = await stageImageImport(uow, blobs, workspaceId, sourceId, files);
  if (blobs) {
    const upload = new UploadFolderImportAssetService(uow, blobs);
    for (const key of staged.assetUploads) {
      const entry = staged.entries.find((candidate) => candidate.key === key)!;
      await upload.upload(fixtureCaller(), { snapshotId: staged.snapshotId, uploadKey: key, body: stream(entry.bytes), contentLength: entry.bytes.byteLength });
    }
  }
  await new FinalizeFolderImportService(uow).finalize(fixtureCaller(), staged.snapshotId);
  return staged;
}
```

`tests/integration/folder-images-import.test.ts` (set-up copied from `tests/integration/personal-profile.test.ts`: isolated database, `createSourceFixture`, the workspace turned into the caller's Personal workspace):

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { provisionIsolatedDatabase, disposeIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { FilesystemBlobStore } from "@/infrastructure/storage/filesystem-blob-store";
import { UploadFolderImportAssetService } from "@/modules/sources/application/upload-folder-import-asset";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { buildApplicationServices } from "@/server/composition";
import { createSourceFixture, fixtureCaller, secondFixtureIdentity } from "../fixtures/knowledge";
import { png, sha256, stageImageImport, stream } from "../fixtures/folder-images";

let pool: Pool, handle: IsolatedDatabaseHandle, uow: MariaDbUnitOfWork, blobs: FilesystemBlobStore, root: string, ws: string;
let s: ReturnType<typeof buildApplicationServices>;
beforeAll(async () => {
  handle = await provisionIsolatedDatabase("test");
  pool = createDatabasePool({ ...databaseConfig("test"), database: handle.databaseName });
  await runMigrations(pool);
  uow = new MariaDbUnitOfWork(pool);
  root = await mkdtemp(path.join(tmpdir(), "km-images-"));
  blobs = new FilesystemBlobStore(root);
  s = buildApplicationServices(pool, { blobStore: blobs });
});
beforeEach(async () => {
  if (ws) await pool.query("UPDATE workspaces SET workspace_type='TEAM',personal_owner_user_id=NULL WHERE id=?", [ws]);
  ws = (await createSourceFixture(pool)).workspaceId;
  await pool.query("UPDATE workspaces SET name='My Space',workspace_type='PERSONAL',personal_owner_user_id=? WHERE id=?", [fixtureCaller().identity.id, ws]);
});
afterAll(async () => { await pool?.end(); if (handle) await disposeIsolatedDatabase(handle); await rm(root, { recursive: true, force: true }); });

const files = [{ path: "guide.md", text: "# Guide\n![d](img/d.png)" }, { path: "img/d.png", bytes: png("d") }, { path: "notes.pdf", bytes: png("pdf") }, { path: "empty.png", bytes: new Uint8Array() }];
const entryRow = async (snapshotId: string, key: string) => (await pool.query("SELECT upload_status, source_file_hash FROM source_import_snapshot_entries WHERE snapshot_id=? AND upload_key=?", [snapshotId, key]))[0];

it("asks for the bytes of non-empty images only, and stages them PENDING", async () => {
  const staged = await stageImageImport(uow, blobs, ws, null, files);
  expect(staged.assetUploads).toEqual(["f1"]);
  expect(await entryRow(staged.snapshotId, "f1")).toMatchObject({ upload_status: "PENDING", source_file_hash: null });
  expect(await entryRow(staged.snapshotId, "f2")).toMatchObject({ upload_status: "RECEIVED", source_file_hash: null });
  expect(await entryRow(staged.snapshotId, "f3")).toMatchObject({ upload_status: "RECEIVED", source_file_hash: null });
});
it("asks for nothing when the store is off", async () => {
  expect((await stageImageImport(uow, null, ws, null, files)).assetUploads).toEqual([]);
});
it("stores verified bytes, records the proof, and accepts a replay", async () => {
  const staged = await stageImageImport(uow, blobs, ws, null, files);
  const upload = new UploadFolderImportAssetService(uow, blobs);
  const bytes = png("d"), input = { snapshotId: staged.snapshotId, uploadKey: "f1", contentLength: bytes.byteLength };
  expect(await upload.upload(fixtureCaller(), { ...input, body: stream(bytes) })).toEqual({ accepted: true });
  expect(await blobs.has(sha256(bytes))).toBe(true);
  expect(await entryRow(staged.snapshotId, "f1")).toMatchObject({ upload_status: "RECEIVED", source_file_hash: sha256(bytes) });
  expect(await upload.upload(fixtureCaller(), { ...input, body: stream(bytes) })).toEqual({ accepted: false });
});
it("rejects wrong bytes, a wrong length, a non-image key and another user, storing nothing", async () => {
  const staged = await stageImageImport(uow, blobs, ws, null, files);
  const upload = new UploadFolderImportAssetService(uow, blobs);
  const bytes = png("d"), wrong = png("x"), base = { snapshotId: staged.snapshotId, uploadKey: "f1" };
  await expect(upload.upload(fixtureCaller(), { ...base, body: stream(wrong), contentLength: wrong.byteLength })).rejects.toMatchObject({ code: "UPLOAD_SIZE_MISMATCH" });
  await expect(upload.upload(fixtureCaller(), { ...base, body: stream(bytes), contentLength: bytes.byteLength + 1 })).rejects.toMatchObject({ code: "UPLOAD_SIZE_MISMATCH" });
  await expect(upload.upload(fixtureCaller(), { ...base, uploadKey: "f0", body: stream(bytes), contentLength: bytes.byteLength })).rejects.toMatchObject({ code: "UPLOAD_ENTRY_NOT_FOUND" });
  await expect(upload.upload(fixtureCaller(), { ...base, uploadKey: "f2", body: stream(bytes), contentLength: bytes.byteLength })).rejects.toMatchObject({ code: "UPLOAD_ENTRY_NOT_FOUND" });
  await expect(upload.upload(fixtureCaller(secondFixtureIdentity), { ...base, body: stream(bytes), contentLength: bytes.byteLength })).rejects.toMatchObject({ code: "IMPORT_SNAPSHOT_NOT_FOUND" });
  expect(await blobs.has(sha256(bytes))).toBe(false);
  expect(await entryRow(staged.snapshotId, "f1")).toMatchObject({ upload_status: "PENDING" });
});
it("does not accept another workspace's blob as proof: finalize waits for this snapshot's own upload", async () => {
  const bytes = png("d");
  await blobs.put(sha256(bytes), stream(bytes), bytes.byteLength);
  const staged = await stageImageImport(uow, blobs, ws, null, files);
  expect(staged.assetUploads).toEqual(["f1"]);
  await expect(new FinalizeFolderImportService(uow).finalize(fixtureCaller(), staged.snapshotId)).rejects.toMatchObject({ code: "UPLOAD_INCOMPLETE" });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts tests/unit/stored-image.test.ts; echo "EXIT=$?"` → `EXIT=1`.
Run: `make db-up && ./node_modules/.bin/vitest run --config vitest.integration.config.ts tests/integration/folder-images-import.test.ts; echo "EXIT=$?"` → `EXIT=1` (modules missing).

- [ ] **Step 3: Domain helper**

`src/modules/sources/domain/stored-image.ts`:

```ts
import { imageContentType } from "@/shared/markdown/image-path";

/** An asset row whose bytes are in the blob store. */
export function isStoredImage(asset: { sourcePath: string; contentHash: string | null; metadata: Record<string, unknown> }): boolean {
  return asset.contentHash !== null && asset.metadata.stored === true && imageContentType(asset.sourcePath) !== null;
}

/**
 * Whether an import must send an image's bytes. Not when this same source
 * already stores that hash; an empty file is recorded but never stored.
 */
export function needsImageBytes(entry: { relativePath: string; size: number; contentHash: string }, storedHashes: ReadonlySet<string>): boolean {
  return entry.size > 0 && imageContentType(entry.relativePath) !== null && !storedHashes.has(entry.contentHash);
}
```

- [ ] **Step 4: Stage images in `create-folder-import.ts`**

Change the result type and options:

```ts
export type CreateImportResult = { snapshotId: string; state: "BUILDING"; expiresAt: Date; assetUploads: string[] };
```

Add `storeImages?: boolean` to the file's `Options` type and, in the constructor, `this.storeImages = options.storeImages ?? false;` with a `private readonly storeImages: boolean;` field.

Replace `stagingEntries` with:

```ts
/** `storedHashes` is null when images are not stored on this server. */
function stagingEntries(snapshotId: string, manifest: readonly ImportManifestEntry[], storedHashes: ReadonlySet<string> | null): ImportSnapshotEntry[] {
  return manifest.map((raw) => {
    const markdown = MARKDOWN_EXTENSION.test(raw.relativePath);
    const asset = raw as Partial<Extract<ImportManifestEntry, { kind: "ASSET" }>>;
    const contentHash = markdown ? null : String(asset.contentHash).toLowerCase();
    const image = contentHash !== null && storedHashes !== null && raw.size > 0 && imageContentType(raw.relativePath) !== null;
    const pending = image && needsImageBytes({ relativePath: raw.relativePath, size: raw.size, contentHash: contentHash! }, storedHashes!);
    return {
      id: uuidv7(), snapshotId, uploadKey: raw.uploadKey, clientRelativePath: raw.relativePath,
      sourcePath: null, sourcePathHash: null, externalId: null, entryType: markdown ? "DOCUMENT" : "ASSET",
      uploadStatus: markdown || pending ? "PENDING" : "RECEIVED", declaredSize: raw.size,
      // For an image, the hash here means "this source's possession of these bytes is proven".
      sourceFileHash: image && !pending ? contentHash : null,
      rawMarkdown: null, resolvedTitle: null, titleSource: null, markdown: null, metadata: null,
      revisionContentHash: null, reconciliationFingerprint: null,
      mimeType: markdown ? null : (asset.mimeType ?? null),
      assetContentHash: contentHash,
      assetSize: markdown ? null : raw.size,
      assetLastModified: markdown ? null : (asset.lastModified ?? null),
      diagnostics: [], previewChange: null,
    };
  });
}
```

Add imports: `import { imageContentType } from "@/shared/markdown/image-path";` and `import { isStoredImage, needsImageBytes } from "@/modules/sources/domain/stored-image";`.

In `buildSnapshot`, change the return type to `ImportSnapshot` and the last line to `return snapshot;`. In `createBound`, build the entries inside the transaction, where the source's current assets can be read:

```ts
    const snapshot = this.buildSnapshot(caller, input);
    let entries: ImportSnapshotEntry[] = [];
    await this.uow.runWithCreatorQuotaLock(caller.identity.id, this.quotaLockTimeoutSeconds, async (repositories) => {
      await lockWorkspaceForMutation(repositories, caller, input.workspaceId, "source-import");
      await this.assertQuota(repositories, caller, snapshot.createdAt);
      const stored = !this.storeImages ? null
        : new Set(input.sourceId === null ? [] : (await repositories.assets.listBySourceId(input.sourceId)).filter(isStoredImage).map((asset) => asset.contentHash!));
      entries = stagingEntries(snapshot.id, input.manifest, stored);
      await repositories.importSnapshots.insert(snapshot);
      await repositories.importSnapshotEntries.insertMany(entries);
    });
    return {
      snapshotId: snapshot.id, state: "BUILDING", expiresAt: snapshot.expiresAt,
      assetUploads: entries.filter((entry) => entry.entryType === "ASSET" && entry.uploadStatus === "PENDING").map((entry) => entry.uploadKey),
    };
```

Run `./node_modules/.bin/tsc --noEmit -p .; echo "EXIT=$?"` and fix every other caller of `buildSnapshot` in the file the same way (the compiler lists them).

- [ ] **Step 5: Repository method**

In `src/modules/sources/ports/import-snapshot-entry-repository.ts` add:

```ts
  /** A verified image upload: the entry is received and its bytes are proven to match `contentHash`. */
  markAssetReceived(entryId: string, contentHash: string): Promise<void>;
```

In `src/infrastructure/database/mariadb/repositories/import-snapshot-entries.ts` add, after `markMarkdownReceived`:

```ts
  async markAssetReceived(entryId: string, contentHash: string): Promise<void> {
    await this.connection.query(
      "UPDATE source_import_snapshot_entries SET upload_status='RECEIVED', source_file_hash=? WHERE id=? AND entry_type='ASSET'",
      [contentHash, entryId],
    );
  }
```

- [ ] **Step 6: The upload service**

`src/modules/sources/application/upload-folder-import-asset.ts`:

```ts
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { lockWorkspaceForMutation } from "@/modules/workspaces/application/workspace-mutation-guard";
import { importError } from "@/modules/sources/domain/import-errors";
import { BlobMismatchError, type BlobBody, type BlobStore } from "@/modules/sources/ports/blob-store";
import type { SourceRepositories, SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";
import { imageContentType } from "@/shared/markdown/image-path";
import { translateKnownSnapshotAccessError } from "./import-snapshot-access";

type Input = { snapshotId: string; uploadKey: string; body: BlobBody; contentLength: number };
type Pending = { entryId: string; hash: string; size: number };

export class UploadFolderImportAssetService {
  private readonly now: () => Date;
  constructor(private readonly uow: SourceUnitOfWork, private readonly blobs: BlobStore, options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Stores one image of a BUILDING snapshot. The bytes are always read and
   * hashed, even when the store already holds that hash: another workspace
   * having the file is not this caller's proof of having it.
   */
  async upload(caller: CallerContext, input: Input): Promise<{ accepted: boolean }> {
    const pending = await this.uow.run((repositories) => this.pending(repositories, caller, input));
    if (!pending) return { accepted: false };
    if (input.contentLength !== pending.size) throw importError("UPLOAD_SIZE_MISMATCH", "Uploaded image size does not match the manifest declaration.");
    try {
      // Outside any transaction: a 64 MiB upload must not hold the snapshot's row lock.
      await this.blobs.put(pending.hash, input.body, pending.size);
    } catch (error) {
      if (error instanceof BlobMismatchError) throw importError("UPLOAD_SIZE_MISMATCH", "Uploaded image does not match the manifest declaration.");
      throw error;
    }
    await this.uow.run(async (repositories) => {
      // Re-checked: the snapshot may have been abandoned or expired while the bytes arrived.
      const still = await this.pending(repositories, caller, input);
      if (still) await repositories.importSnapshotEntries.markAssetReceived(still.entryId, pending.hash);
    });
    return { accepted: true };
  }

  private async pending(repositories: SourceRepositories, caller: CallerContext, input: Input): Promise<Pending | null> {
    const snapshot = await repositories.importSnapshots.lockById(input.snapshotId);
    if (!snapshot || snapshot.createdBy !== caller.identity.id) throw importError("IMPORT_SNAPSHOT_NOT_FOUND", "Import snapshot was not found.");
    try {
      await lockWorkspaceForMutation(repositories, caller, snapshot.workspaceId, "source-import");
    } catch (error) {
      throw translateKnownSnapshotAccessError(error);
    }
    if (snapshot.state !== "BUILDING") throw importError("IMPORT_SNAPSHOT_NOT_BUILDING", "Only BUILDING snapshots accept uploads.");
    if (snapshot.expiresAt.getTime() <= this.now().getTime()) throw importError("IMPORT_SNAPSHOT_EXPIRED", "Import snapshot has expired.");
    const staged = await repositories.importSnapshotEntries.findByUploadKey(snapshot.id, input.uploadKey);
    if (!staged || staged.entryType !== "ASSET" || staged.assetContentHash === null || imageContentType(staged.clientRelativePath) === null) {
      throw importError("UPLOAD_ENTRY_NOT_FOUND", "Upload key does not identify an image manifest entry.");
    }
    if (staged.uploadStatus === "RECEIVED") {
      // Received without proof is a non-stored asset (empty file, or staged while the store was off).
      if (staged.sourceFileHash === null) throw importError("UPLOAD_ENTRY_NOT_FOUND", "Upload key does not identify an image manifest entry.");
      return null;
    }
    return { entryId: staged.id, hash: staged.assetContentHash, size: staged.declaredSize };
  }
}
```

The fixture's `empty.png` (`f3`) is `RECEIVED` with no proof, so the test's "non-image key" expectations cover that branch through `f2`; `f3` behaves the same.

- [ ] **Step 7: Wire it**

`src/server/composition.ts`:
- Add imports for `UploadFolderImportAssetService`, `type BlobStore`, and `configuredBlobStore` from `@/server/blob-store`.
- Extend the options type of `buildApplicationServices`: `blobStore?: BlobStore | null;`.
- After `const importConfig = importRuntimeConfig();` add `const blobs = options.blobStore === undefined ? configuredBlobStore() : options.blobStore;`.
- In `imports`: `create: new CreateFolderImportService(unitOfWork, { limits: importConfig.limits, buildingTtlMs: importConfig.buildingTtlMs, storeImages: blobs !== null }),` and add `uploadAsset: blobs ? new UploadFolderImportAssetService(unitOfWork, blobs) : null,`.
- Add `blobs,` to the returned object.

`src/server/source-imports.ts`, after `uploadSourceImportEntries`:

```ts
export async function uploadSourceImportAsset(
  snapshotId: string,
  input: { uploadKey: string; body: ReadableStream<Uint8Array>; contentLength: number },
): Promise<{ accepted: boolean }> {
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  const uploadAsset = services.imports.uploadAsset;
  // Images are not stored on this server, so no manifest entry is waiting for bytes.
  if (!uploadAsset) throw importError("UPLOAD_ENTRY_NOT_FOUND", "Upload key does not identify an image manifest entry.");
  return withKnownSnapshotAccess(() => uploadAsset.upload(caller, { snapshotId, ...input }));
}
```

with `import { importError } from "@/modules/sources/domain/import-errors";`.

`src/app/api/source-imports/[snapshotId]/asset/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { importError } from "@/modules/sources/domain/import-errors";
import { importRuntimeConfig } from "@/server/import-config";
import { toImportErrorResponse } from "@/server/http-error-response";
import { validateUploadContentLength } from "@/server/import-route-adapters";
import { uploadSourceImportAsset } from "@/server/source-imports";

export async function PUT(request: NextRequest, context: { params: Promise<{ snapshotId: string }> }) {
  try {
    const { snapshotId } = await context.params;
    const contentLength = validateUploadContentLength(request.headers.get("content-length"), importRuntimeConfig().limits.maxAssetFileBytes);
    if (!request.body) throw importError("INVALID_UPLOAD_BATCH", "An image upload requires a body.");
    const uploadKey = request.nextUrl.searchParams.get("uploadKey") ?? "";
    return NextResponse.json(await uploadSourceImportAsset(snapshotId, { uploadKey, body: request.body, contentLength }));
  } catch (error) {
    // The image volume is full: nothing was applied, and it is the operator's to fix.
    if ((error as NodeJS.ErrnoException).code === "ENOSPC") {
      return NextResponse.json({ error: { code: "IMAGE_STORAGE_FULL", message: "The server's image storage is full. Nothing was synced." } }, { status: 507 });
    }
    const mapped = toImportErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
```

- [ ] **Step 8: Run the tests**

Run both commands from Step 2. Expected: unit `EXIT=0`; integration: every test passes **except** "does not accept another workspace's blob as proof", which still fails because Finalize does not yet check image entries. That is Task 4.
Run: `./node_modules/.bin/tsc --noEmit -p .; echo "EXIT=$?"` → `EXIT=0`. Test doubles of `ImportSnapshotEntryRepository` elsewhere in `tests/` need the new method; add `markAssetReceived: async () => {}` where the compiler asks.

- [ ] **Step 9: Commit**

```bash
git add src/modules/sources src/infrastructure/database/mariadb/repositories/import-snapshot-entries.ts src/server/composition.ts src/server/source-imports.ts "src/app/api/source-imports/[snapshotId]/asset" tests/unit/stored-image.test.ts tests/fixtures/folder-images.ts tests/integration/folder-images-import.test.ts
git commit -m "feat(images): stage synced images and accept their verified bytes"
```

---

### Task 4: Finalize requires the images and marks them stored

**Files:**
- Modify: `src/modules/sources/application/finalize-folder-import.ts:200-202` (the upload-complete check) and `:259-272` (asset metadata)
- Test: `tests/integration/folder-images-import.test.ts` (extend)

**Interfaces:**
- Consumes: staged entries where an image with proven bytes has `sourceFileHash === assetContentHash` (Task 3); `prepareImageImport` (Task 3)
- Produces: `knowledge_assets.metadata.stored === true` for stored images after Apply, which `isStoredImage` reads. The reconciler is not changed: `sameAsset` already compares metadata, so an image that was reference-only (`{size,lastModified}`) and is now `{size,lastModified,stored:true}` reconciles as `UPDATED`.

- [ ] **Step 1: Add the failing tests**

Append to `tests/integration/folder-images-import.test.ts` (add `prepareImageImport` to the fixture import):

```ts
const assetRows = async (sourceId: string) => (await pool.query("SELECT source_path, content_hash, JSON_EXTRACT(metadata,'$.stored') stored FROM knowledge_assets WHERE source_id=? ORDER BY source_path", [sourceId]))
  .map((row: { source_path: string; content_hash: string; stored: unknown }) => ({ path: row.source_path, hash: row.content_hash, stored: row.stored === true || row.stored === 1 || row.stored === "true" }));
const applied = async (snapshotId: string) => { const result = await s.imports.apply.apply(fixtureCaller(), snapshotId); if (result.kind !== "APPLIED") throw Error("fixture"); return result; };

it("marks stored images on Apply and leaves other assets reference-only", async () => {
  const { snapshotId } = await prepareImageImport(uow, blobs, ws, null, files);
  const { sourceId } = await applied(snapshotId);
  expect(await assetRows(sourceId)).toEqual([
    { path: "empty.png", hash: sha256(new Uint8Array()), stored: false },
    { path: "img/d.png", hash: sha256(png("d")), stored: true },
    { path: "notes.pdf", hash: sha256(png("pdf")), stored: false },
  ]);
});
it("re-syncing an unchanged folder asks for no bytes and plans no asset change", async () => {
  const { sourceId } = await applied((await prepareImageImport(uow, blobs, ws, null, files)).snapshotId);
  const again = await prepareImageImport(uow, blobs, ws, sourceId, files);
  expect(again.assetUploads).toEqual([]);
  const preview = await s.imports.preview.get(fixtureCaller(), again.snapshotId);
  expect(preview.summary.assets).toEqual({ added: 0, updated: 0, removed: 0, unchanged: 3 });
});
it("a source imported before images were stored gets them on its next sync, as an update", async () => {
  const { sourceId } = await applied((await prepareImageImport(uow, null, ws, null, files)).snapshotId);
  expect((await assetRows(sourceId)).every((row) => !row.stored)).toBe(true);
  const next = await prepareImageImport(uow, blobs, ws, sourceId, files);
  expect(next.assetUploads).toEqual(["f1"]);
  expect((await s.imports.preview.get(fixtureCaller(), next.snapshotId)).summary.assets).toEqual({ added: 0, updated: 1, removed: 0, unchanged: 2 });
  await applied(next.snapshotId);
  expect((await assetRows(sourceId)).find((row) => row.path === "img/d.png")!.stored).toBe(true);
});
it("a changed image is uploaded again and replaces the stored hash", async () => {
  const { sourceId } = await applied((await prepareImageImport(uow, blobs, ws, null, files)).snapshotId);
  const changed = files.map((file) => file.path === "img/d.png" ? { path: file.path, bytes: png("d2") } : file);
  const next = await prepareImageImport(uow, blobs, ws, sourceId, changed);
  expect(next.assetUploads).toEqual(["f1"]);
  await applied(next.snapshotId);
  expect((await assetRows(sourceId)).find((row) => row.path === "img/d.png")).toEqual({ path: "img/d.png", hash: sha256(png("d2")), stored: true });
});
```

- [ ] **Step 2: Run and see them fail**

Run: `./node_modules/.bin/vitest run --config vitest.integration.config.ts tests/integration/folder-images-import.test.ts; echo "EXIT=$?"`
Expected: the four new tests and the "another workspace's blob" test fail; `EXIT=1`.

- [ ] **Step 3: Implement**

In `finalize-folder-import.ts`, replace the check at lines 200-202:

```ts
    // Images are PENDING until their bytes are verified (upload-folder-import-asset.ts).
    if (staged.some((entry) => entry.uploadStatus !== "RECEIVED")) {
      throw importError("UPLOAD_INCOMPLETE", "Every Markdown file and image must be received before finalization.");
    }
```

and the asset metadata at lines 260-264:

```ts
          const metadata = {
            size: entry.staged.assetSize,
            lastModified: entry.staged.assetLastModified?.toISOString() ?? null,
            // Present only when this snapshot proved the bytes; `isStoredImage` reads it.
            ...(entry.staged.sourceFileHash !== null && entry.staged.sourceFileHash === entry.staged.assetContentHash ? { stored: true } : {}),
          };
```

- [ ] **Step 4: Run and see them pass**

Run the Step 2 command → `EXIT=0`.
Run the full import suites, which exercise Finalize: `./node_modules/.bin/vitest run --config vitest.integration.config.ts tests/integration/phase2-import-*.test.ts; echo "EXIT=$?"` → `EXIT=0`.
Run: `./node_modules/.bin/vitest run --config vitest.config.ts; echo "EXIT=$?"` → `EXIT=0`. A unit test asserting the old `UPLOAD_INCOMPLETE` wording is updated to the new sentence.

- [ ] **Step 5: Commit**

```bash
git add src/modules/sources/application/finalize-folder-import.ts tests
git commit -m "feat(images): finalize waits for image bytes and marks them stored"
```

---

### Task 5: Serve an image to a signed-in reader

**Files:**
- Create: `src/modules/knowledge/application/document-image-service.ts`, `src/server/document-images.ts`, `src/app/api/documents/[documentId]/asset/route.ts`
- Modify: `src/modules/knowledge/domain/source-policy.ts`, `src/modules/knowledge/ports/source-policy.ts`, `src/infrastructure/database/mariadb/repositories/source-policy.ts`, `src/infrastructure/database/mariadb/repositories/index.ts:55`, `src/modules/sources/ports/asset-repository.ts`, `src/infrastructure/database/mariadb/repositories/assets.ts`, `src/server/composition.ts`, `next.config.ts`
- Test: `tests/unit/document-images.test.ts`, `tests/integration/folder-images-read.test.ts`

**Interfaces:**
- Consumes: `resolveImagePath`, `imageContentType` (Task 1); `BlobStore` (Task 2); `isStoredImage` (Task 3); `prepareImageImport` (Task 3)
- Produces:
  - `type StoredImage = { contentHash: string; contentType: string; sourcePath: string; documentPath: string }` in `src/modules/knowledge/domain/source-policy.ts`
  - `SourcePolicyPort.findStoredImage(documentId: string, src: string): Promise<StoredImage | null>`
  - `AssetRepository.findByPath(sourceId: string, sourcePath: string): Promise<KnowledgeAsset | null>`
  - `DocumentImageService.find(caller: CallerContext, documentId: string, src: string): Promise<StoredImage | null>`; `applicationServices().documentImages`
  - `imageResponse(request: Request, image: StoredImage | null, blobs: BlobStore | null): Promise<Response>` in `src/server/document-images.ts`
  - `GET /api/documents/:documentId/asset?src=<as written>`

- [ ] **Step 1: Write the failing tests**

`tests/unit/document-images.test.ts`:

```ts
import { expect, it } from "vitest";
import { imageResponse } from "@/server/document-images";
import type { BlobStore } from "@/modules/sources/ports/blob-store";

const hash = "b".repeat(64);
const image = { contentHash: hash, contentType: "image/svg+xml", sourcePath: "a.svg", documentPath: "a.md" };
const blobs = (present: boolean) => ({ open: async () => present ? { body: new Blob(["<svg/>"]).stream(), size: 6 } : null }) as unknown as BlobStore;
const get = (headers: Record<string, string> = {}) => new Request("http://hub.test/x", { headers });

it("serves the bytes with the type from the path and headers that keep an SVG inert", async () => {
  const response = await imageResponse(get(), image, blobs(true));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("<svg/>");
  expect(Object.fromEntries(response.headers)).toMatchObject({
    "content-type": "image/svg+xml", "content-length": "6", etag: `"${hash}"`,
    "x-content-type-options": "nosniff", "content-disposition": "inline", "cache-control": "private, no-cache",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  });
});
it("answers 304 to a matching ETag without opening the blob", async () => {
  const response = await imageResponse(get({ "if-none-match": `"${hash}"` }), image, { open: async () => { throw new Error("opened"); } } as unknown as BlobStore);
  expect(response.status).toBe(304);
  expect(response.headers.get("etag")).toBe(`"${hash}"`);
});
it("is one 404 for no image, no store and a missing blob", async () => {
  for (const response of [await imageResponse(get(), null, blobs(true)), await imageResponse(get(), image, null), await imageResponse(get(), image, blobs(false))]) {
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  }
});
```

`tests/integration/folder-images-read.test.ts`. Copy the import block and the `beforeAll` / `beforeEach` / `afterAll` hooks from `folder-images-import.test.ts` verbatim, and import `png`, `sha256`, `prepareImageImport` from `../fixtures/folder-images`. Then:

```ts
const md = "# Guide\n![d](img/d.png) ![up](../shared.svg) ![root](/img/d.png)";
const files = [{ path: "guides/guide.md", text: md }, { path: "guides/img/d.png", bytes: png("d") }, { path: "shared.svg", bytes: png("svg") }, { path: "img/d.png", bytes: png("root") }, { path: "guides/notes.pdf", bytes: png("pdf") }];
async function imported() {
  const result = await s.imports.apply.apply(fixtureCaller(), (await prepareImageImport(uow, blobs, ws, null, files)).snapshotId);
  if (result.kind !== "APPLIED") throw Error("fixture");
  const documentId = String((await pool.query("SELECT document_id FROM source_entries WHERE source_id=? AND source_path='guides/guide.md'", [result.sourceId]))[0].document_id);
  return { sourceId: result.sourceId, documentId };
}

it("finds an image as the document writes it: relative, parent and root paths", async () => {
  const { documentId } = await imported();
  const find = (src: string) => s.documentImages.find(fixtureCaller(), documentId, src);
  expect(await find("img/d.png")).toEqual({ contentHash: sha256(png("d")), contentType: "image/png", sourcePath: "guides/img/d.png", documentPath: "guides/guide.md" });
  expect((await find("../shared.svg"))!.contentType).toBe("image/svg+xml");
  expect((await find("/img/d.png"))!.contentHash).toBe(sha256(png("root")));
  expect((await find("img/d.png?v=2"))!.sourcePath).toBe("guides/img/d.png");
});
it("finds nothing for a missing file, a non-image, a path outside the root or a URL", async () => {
  const { documentId } = await imported();
  for (const src of ["img/absent.png", "notes.pdf", "../../etc/passwd", "https://x.test/a.png", ""]) expect(await s.documentImages.find(fixtureCaller(), documentId, src), src).toBeNull();
});
it("does not reach an image in another source through this document", async () => {
  const { documentId } = await imported();
  const other = await s.imports.apply.apply(fixtureCaller(), (await prepareImageImport(uow, blobs, ws, null, [{ path: "o.md", text: "# O" }, { path: "only-here.png", bytes: png("other") }])).snapshotId);
  expect(other.kind).toBe("APPLIED");
  expect(await s.documentImages.find(fixtureCaller(), documentId, "/only-here.png")).toBeNull();
});
it("denies a caller who cannot read the document exactly as the document read does", async () => {
  const { documentId } = await imported();
  const outsider = fixtureCaller(secondFixtureIdentity);
  await pool.query("DELETE FROM workspace_memberships WHERE workspace_id=? AND user_id=?", [ws, secondFixtureIdentity.id]);
  const documentError = await s.queries.getDocument(outsider, documentId).catch((error: Error) => error.constructor.name);
  const imageError = await s.documentImages.find(outsider, documentId, "img/d.png").catch((error: Error) => error.constructor.name);
  expect(typeof documentError).toBe("string");
  expect(imageError).toBe(documentError);
  await expect(s.documentImages.find(fixtureCaller(), "0199f000-0000-7000-8000-00000000dead", "img/d.png")).rejects.toThrow();
});
it("finds nothing once an image is no longer stored", async () => {
  const { sourceId, documentId } = await imported();
  await pool.query("UPDATE knowledge_assets SET metadata=JSON_REMOVE(metadata,'$.stored') WHERE source_id=?", [sourceId]);
  expect(await s.documentImages.find(fixtureCaller(), documentId, "img/d.png")).toBeNull();
});
```

- [ ] **Step 2: Run and see them fail**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts tests/unit/document-images.test.ts; echo "EXIT=$?"` → `EXIT=1`.
Run: `./node_modules/.bin/vitest run --config vitest.integration.config.ts tests/integration/folder-images-read.test.ts; echo "EXIT=$?"` → `EXIT=1`.

- [ ] **Step 3: Port and adapters**

`src/modules/knowledge/domain/source-policy.ts`, append:

```ts
/** A stored image in a document's own source. `documentPath` lets a caller resolve other sources the same way. */
export type StoredImage = { contentHash: string; contentType: string; sourcePath: string; documentPath: string };
```

`src/modules/knowledge/ports/source-policy.ts`, add to the interface (and import `StoredImage`):

```ts
  /**
   * The stored image `src` points at, read as the document's Markdown writes it.
   * Looks only in the document's own source. Authorizes nothing: the caller has
   * already decided the reader may see this document.
   */
  findStoredImage(documentId: string, src: string): Promise<StoredImage | null>;
```

`src/modules/sources/ports/asset-repository.ts`, add `findByPath(sourceId: string, sourcePath: string): Promise<KnowledgeAsset | null>;`

`src/infrastructure/database/mariadb/repositories/assets.ts`, add:

```ts
  async findByPath(sourceId: string, sourcePath: string): Promise<KnowledgeAsset | null> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT * FROM knowledge_assets WHERE source_id = ? AND source_path_hash = ?",
      [sourceId, createHash("sha256").update(sourcePath, "utf8").digest("hex")],
    );
    return rows[0] ? mapAsset(rows[0]) : null;
  }
```

`src/infrastructure/database/mariadb/repositories/source-policy.ts`: change the constructor to `constructor(private readonly sources: SourceRepository, private readonly entries: EntryRepository, private readonly assets: AssetRepository) {}` (import both port types) and add:

```ts
  async findStoredImage(documentId: string, src: string): Promise<StoredImage | null> {
    const entry = await this.entries.findByDocumentId(documentId);
    if (!entry) return null;
    const sourcePath = resolveImagePath(entry.sourcePath, src);
    const contentType = sourcePath === null ? null : imageContentType(sourcePath);
    if (sourcePath === null || contentType === null) return null;
    const asset = await this.assets.findByPath(entry.sourceId, sourcePath);
    if (!asset || !isStoredImage(asset)) return null;
    return { contentHash: asset.contentHash!, contentType, sourcePath, documentPath: entry.sourcePath };
  }
```

with imports of `resolveImagePath`, `imageContentType`, `isStoredImage`, `StoredImage`.

`src/infrastructure/database/mariadb/repositories/index.ts`: hoist the two repositories into constants above the returned object and pass them:

```ts
  const entries = new MariaDbEntryRepository(connection);
  const assets = new MariaDbAssetRepository(connection);
```

then use `entries,`, `assets,` and `sourcePolicy: new MariaDbSourcePolicyRepository(sources, entries, assets),` in the object. Run `./node_modules/.bin/tsc --noEmit -p .` and give every other `SourcePolicyPort` implementation or test double a `findStoredImage: async () => null`.

- [ ] **Step 4: The application service**

`src/modules/knowledge/application/document-image-service.ts`:

```ts
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { StoredImage } from "../domain/source-policy";
import type { KnowledgeUnitOfWork } from "../ports/unit-of-work";
import { requireVisibleDocument } from "./internal/require-visible-document";

export class DocumentImageService {
  constructor(private readonly unitOfWork: KnowledgeUnitOfWork) {}

  /**
   * An image a document's Markdown refers to. The right to see it is the right
   * to read the document, checked here on every call; the document ID and the
   * path in the URL prove nothing. Archived documents keep their images, as
   * they keep their text for a member who asks for them.
   */
  async find(caller: CallerContext, documentId: string, src: string): Promise<StoredImage | null> {
    return this.unitOfWork.run(async (repositories) => {
      await requireVisibleDocument(repositories, caller, documentId, true);
      return repositories.sourcePolicy.findStoredImage(documentId, src);
    });
  }
}
```

In `src/server/composition.ts` add `documentImages: new DocumentImageService(unitOfWork),` to the returned object, with its import.

- [ ] **Step 5: The response builder and the route**

`src/server/document-images.ts`:

```ts
import type { StoredImage } from "@/modules/knowledge/domain/source-policy";
import type { BlobStore } from "@/modules/sources/ports/blob-store";

/**
 * On every image response. `nosniff` and the sandboxing policy are what make
 * an SVG safe to serve from the app's own origin: opened directly it runs no
 * script. `no-cache` makes the browser re-ask each time, so authorization is
 * re-checked and an unchanged image costs a 304.
 */
export const IMAGE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "Content-Disposition": "inline",
  "Cache-Control": "private, no-cache",
} as const;

export async function imageResponse(request: Request, image: StoredImage | null, blobs: BlobStore | null): Promise<Response> {
  const notFound = () => new Response(null, { status: 404, headers: IMAGE_HEADERS });
  if (!image || !blobs) return notFound();
  const etag = `"${image.contentHash}"`;
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ...IMAGE_HEADERS, ETag: etag } });
  const blob = await blobs.open(image.contentHash);
  if (!blob) return notFound();
  return new Response(blob.body, { headers: { ...IMAGE_HEADERS, ETag: etag, "Content-Type": image.contentType, "Content-Length": String(blob.size) } });
}
```

`src/app/api/documents/[documentId]/asset/route.ts`:

```ts
import { NextResponse } from "next/server";
import { applicationServices } from "@/server/composition";
import { imageResponse } from "@/server/document-images";
import { toWorkspaceErrorResponse } from "@/server/http-error-response";

// Not workspaceHttp: that forces `no-store`, and an image answers revalidation with a 304.
export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const services = applicationServices();
    const { caller } = await services.establishTrustedCaller();
    const src = new URL(request.url).searchParams.get("src") ?? "";
    const image = await services.documentImages.find(caller, (await context.params).documentId, src);
    return await imageResponse(request, image, services.blobs);
  } catch (error) {
    const mapped = toWorkspaceErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status, headers: { "Cache-Control": "private, no-store" } });
  }
}
```

- [ ] **Step 6: Make the headers certain in `next.config.ts`**

Next keeps the last matching rule per header key, and `/:path*` sets a `Content-Security-Policy` that does not sandbox. Add these two rules **after** the `/s/:path*` rule, so they win for the image routes whatever the handler sends (the `/s/:token/asset` route arrives in Task 7; listing it now keeps the header rules in one place):

```ts
      // Image bytes (folder-sync images spec §6.1). Last, so they win: a
      // directly opened SVG must get the sandboxing policy, not the page one.
      ...["/api/documents/:documentId/asset", "/s/:token/asset"].map((source) => ({
        source,
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Content-Security-Policy", value: "default-src 'none'; style-src 'unsafe-inline'; sandbox" },
          { key: "Content-Disposition", value: "inline" },
        ],
      })),
```

The e2e test in Task 10 reads these headers off the wire, which is the check that the rules are in force.

- [ ] **Step 7: Run and see them pass**

Run both commands from Step 2 → `EXIT=0`.
Run: `make typecheck lint build > "${CLAUDE_JOB_DIR:-/tmp}/km-build.log" 2>&1; echo "EXIT=$?"` → `EXIT=0`.
Run: `./node_modules/.bin/vitest run --config vitest.config.ts tests/unit/share-link-single-exception.test.ts; echo "EXIT=$?"` → `EXIT=0`, unchanged: `find` takes a `CallerContext`.

- [ ] **Step 8: Commit**

```bash
git add src/modules/knowledge src/modules/sources/ports/asset-repository.ts src/infrastructure/database/mariadb/repositories src/server/composition.ts src/server/document-images.ts "src/app/api/documents/[documentId]/asset" next.config.ts tests/unit/document-images.test.ts tests/integration/folder-images-read.test.ts
git commit -m "feat(images): serve a document's images behind its read check"
```

---

### Task 6: The reader draws them

**Files:**
- Create: `src/components/knowledge/markdown-image-base.tsx`
- Modify: `src/components/knowledge/markdown-image.tsx`, `src/components/knowledge/document-viewer.tsx`
- Test: `tests/unit/markdown-image-base.test.tsx`

**Interfaces:**
- Consumes: `GET /api/documents/:documentId/asset?src=` (Task 5)
- Produces: `MarkdownImageBaseProvider({ base, children }: { base: string; children: ReactNode })`, `imageUrl(base: string | null, src: string): string`

- [ ] **Step 1: Write the failing test**

`tests/unit/markdown-image-base.test.tsx`:

```tsx
import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownImageBaseProvider, imageUrl } from "@/components/knowledge/markdown-image-base";
import { MarkdownRenderer } from "@/components/knowledge/markdown-renderer";

it("sends a relative src to the base, as written and encoded", () => {
  expect(imageUrl("/api/documents/d1/asset", "img/a b.png")).toBe("/api/documents/d1/asset?src=img%2Fa%20b.png");
  expect(imageUrl("/api/documents/d1/asset", "../x.svg?v=1")).toBe("/api/documents/d1/asset?src=..%2Fx.svg%3Fv%3D1");
  expect(imageUrl("/s/tok/asset", "/root.png")).toBe("/s/tok/asset?src=%2Froot.png");
});
it("leaves a src alone with no base, and never rewrites a URL", () => {
  expect(imageUrl(null, "img/a.png")).toBe("img/a.png");
  expect(imageUrl("/api/documents/d1/asset", "https://hub.test/x.png")).toBe("https://hub.test/x.png");
  expect(imageUrl("/api/documents/d1/asset", "//cdn.test/x.png")).toBe("//cdn.test/x.png");
});
it("the renderer draws a relative image through the base and still blocks a remote one", () => {
  const html = renderToStaticMarkup(<MarkdownImageBaseProvider base="/api/documents/d1/asset"><MarkdownRenderer markdown={"![a](img/a.png)\n\n![r](https://evil.test/p.png)"} /></MarkdownImageBaseProvider>);
  expect(html).toContain('src="/api/documents/d1/asset?src=img%2Fa.png"');
  expect(html).toContain("Image blocked: r");
  expect(html).not.toContain("evil.test");
});
it("without a provider the renderer writes the src as before", () => {
  expect(renderToStaticMarkup(<MarkdownRenderer markdown="![a](img/a.png)" />)).toContain('src="img/a.png"');
});
```

- [ ] **Step 2: Run and see it fail**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts tests/unit/markdown-image-base.test.tsx; echo "EXIT=$?"` → `EXIT=1`.

- [ ] **Step 3: Implement**

`src/components/knowledge/markdown-image-base.tsx`:

```tsx
"use client";

import { createContext, type ReactNode } from "react";

/** Where a document's relative images are served from; null leaves a `src` as written. */
export const MarkdownImageBase = createContext<string | null>(null);

export function MarkdownImageBaseProvider({ base, children }: { base: string; children: ReactNode }) {
  return <MarkdownImageBase.Provider value={base}>{children}</MarkdownImageBase.Provider>;
}

/** A relative `src` goes to the base, which resolves it on the server; a URL is never rewritten. */
export function imageUrl(base: string | null, src: string): string {
  return base && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src.trim()) ? `${base}?src=${encodeURIComponent(src)}` : src;
}
```

`src/components/knowledge/markdown-image.tsx`: import `useContext` beside `useState`, import `MarkdownImageBase` and `imageUrl`, add `const base = useContext(MarkdownImageBase);` as the first line of the component, and change the `<img>`'s `src={src}` to `src={imageUrl(base, src)}`. The policy check above it keeps testing the original `src`.

`src/components/knowledge/document-viewer.tsx`: import `MarkdownImageBaseProvider` and wrap the renderer:

```tsx
    <article className={MARKDOWN_ARTICLE}>
      <MarkdownImageBaseProvider base={`/api/documents/${view.documentId}/asset`}>
        <MarkdownRenderer markdown={displayed.markdown} links={links} />
      </MarkdownImageBaseProvider>
    </article>
```

- [ ] **Step 4: Run and see it pass**

Run the Step 2 command → `EXIT=0`.
Run: `./node_modules/.bin/vitest run --config vitest.config.ts; echo "EXIT=$?"` → `EXIT=0` (existing image-policy and renderer tests still pass: nothing changes without a provider).

- [ ] **Step 5: Commit**

```bash
git add src/components/knowledge/markdown-image-base.tsx src/components/knowledge/markdown-image.tsx src/components/knowledge/document-viewer.tsx tests/unit/markdown-image-base.test.tsx
git commit -m "feat(images): the reader draws a document's stored images"
```

---

### Task 7: Shared pages, and the contract that changes with them

**Files:**
- Create: `src/app/s/[token]/asset/route.ts`
- Modify: `src/modules/knowledge/application/document-share-service.ts` (`readShared`, new `readSharedImage`), `src/server/composition.ts` (`shareReadService`), `src/server/share-read.ts`, `src/app/s/[token]/page.tsx`, `tests/unit/share-link-single-exception.test.ts`, `CLAUDE.md`, `docs/superpowers/specs/2026-09-23-document-share-link-design.md` (§6.1, §6.2)
- Test: `tests/integration/folder-images-share.test.ts`

**Interfaces:**
- Consumes: `extractImageSources`, `resolveImagePath` (Task 1); `SourcePolicyPort.findStoredImage`, `StoredImage`, `imageResponse` (Task 5); `configuredBlobStore` (Task 2); `MarkdownImageBaseProvider` (Task 6)
- Produces: `DocumentShareService.readSharedImage(token: string, src: string): Promise<StoredImage>` (throws `ShareLinkNotFoundError` for every failure); `getSharedImage(token: string, src: string): Promise<StoredImage | null>`; `GET /s/:token/asset?src=`

- [ ] **Step 1: Write the failing tests**

`tests/integration/folder-images-share.test.ts`. Copy the import block and the three hooks from `folder-images-import.test.ts` verbatim, import `png`, `sha256`, `prepareImageImport` from `../fixtures/folder-images`, and add:

```ts
import { ShareLinkNotFoundError } from "@/modules/knowledge/domain/document-share-link";

const v1 = "# Guide\n![d](img/d.png) ![old](img/old.png)";
const v2 = "# Guide\n![d](img/d.png)";
const files = (text: string) => [{ path: "guide.md", text }, { path: "img/d.png", bytes: png("d") }, { path: "img/old.png", bytes: png("old") }, { path: "img/secret.png", bytes: png("secret") }, { path: "notes.pdf", bytes: png("pdf") }];
async function shared(text = v1) {
  const result = await s.imports.apply.apply(fixtureCaller(), (await prepareImageImport(uow, blobs, ws, null, files(text))).snapshotId);
  if (result.kind !== "APPLIED") throw Error("fixture");
  const documentId = String((await pool.query("SELECT document_id FROM source_entries WHERE source_id=? AND source_path='guide.md'", [result.sourceId]))[0].document_id);
  const link = await s.shares.create(fixtureCaller(), documentId, { label: "review" });
  return { sourceId: result.sourceId, documentId, link };
}
const denied = (token: string, src: string) => expect(s.shares.readSharedImage(token, src)).rejects.toBeInstanceOf(ShareLinkNotFoundError);
const views = async (linkId: string) => Number((await pool.query("SELECT COALESCE(SUM(view_count),0) n FROM document_share_link_views WHERE share_link_id=?", [linkId]))[0].n);

it("serves an image the shared revision draws, by any spelling of its path, and counts no view", async () => {
  const { link } = await shared();
  expect(await s.shares.readSharedImage(link.token, "img/d.png")).toMatchObject({ contentHash: sha256(png("d")), contentType: "image/png" });
  expect(await s.shares.readSharedImage(link.token, "./img/d.png")).toMatchObject({ sourcePath: "img/d.png" });
  expect(await s.shares.readSharedImage(link.token, "/img/d.png?x=1")).toMatchObject({ sourcePath: "img/d.png" });
  expect(await views(link.id)).toBe(0);
});
it("refuses an image the revision does not draw, a non-image and a path outside the folder, identically", async () => {
  const { link } = await shared();
  for (const src of ["img/secret.png", "notes.pdf", "../../etc/passwd", "img/absent.png", "https://x.test/a.png", ""]) await denied(link.token, src);
});
it("stops serving an image once the current revision no longer draws it", async () => {
  const { sourceId, link } = await shared();
  expect(await s.shares.readSharedImage(link.token, "img/old.png")).toMatchObject({ sourcePath: "img/old.png" });
  const next = await s.imports.apply.apply(fixtureCaller(), (await prepareImageImport(uow, blobs, ws, sourceId, files(v2))).snapshotId);
  expect(next.kind).toBe("APPLIED");
  await denied(link.token, "img/old.png");
  expect(await s.shares.readSharedImage(link.token, "img/d.png")).toMatchObject({ sourcePath: "img/d.png" });
});
it("refuses everything for a revoked, expired or malformed token and an archived document", async () => {
  const { documentId, link } = await shared();
  await denied("not-a-token", "img/d.png");
  await denied("0199f000-0000-4000-8000-000000000000", "img/d.png");
  await pool.query("UPDATE document_share_links SET created_at=DATE_SUB(NOW(6),INTERVAL 2 DAY), expires_at=DATE_SUB(NOW(6),INTERVAL 1 DAY) WHERE id=?", [link.id]);
  await denied(link.token, "img/d.png");
  await pool.query("UPDATE document_share_links SET created_at=NOW(6), expires_at=DATE_ADD(NOW(6),INTERVAL 1 DAY) WHERE id=?", [link.id]);
  expect(await s.shares.readSharedImage(link.token, "img/d.png")).toBeTruthy();
  await uow.run((repositories) => repositories.documents.updateStatus(documentId, "ARCHIVED", fixtureCaller().identity.id));
  await denied(link.token, "img/d.png");
  await uow.run((repositories) => repositories.documents.updateStatus(documentId, "ACTIVE", fixtureCaller().identity.id));
  await s.shares.revoke(fixtureCaller(), link.id);
  await denied(link.token, "img/d.png");
});
```

Before writing code, open `document-share-service.ts` and confirm the names this test uses: `create(caller, documentId, { label })` returning an object with `id` and `token`, and `revoke(caller, linkId)`. Adjust the three call sites if the signatures differ; the assertions do not change.

In `tests/unit/share-link-single-exception.test.ts`:
- first test: title becomes `"...except readShared and readSharedImage"` and the expectation `expect(offenders).toEqual(["document-share-service.ts#readShared", "document-share-service.ts#readSharedImage"]);`
- last test: the regex becomes `/\breadShared(?:Image)?\s*\(|\bshareReadService\s*\(/`.
- add a fifth test:

```ts
  it("blob bytes leave the store only through the image response", () => {
    // Opening a blob takes a hash and no caller. Deciding who may see which
    // image happens before it, in DocumentImageService and readSharedImage.
    const openers = ["src/server", "src/app", "src/components"]
      .flatMap(filesUnder)
      .filter((file) => /\bblobs\.open\s*\(/.test(readFileSync(file, "utf8")));
    expect(openers).toEqual([path.join("src", "server", "document-images.ts")]);
  });
```

- [ ] **Step 2: Run and see them fail**

Run: `./node_modules/.bin/vitest run --config vitest.integration.config.ts tests/integration/folder-images-share.test.ts; echo "EXIT=$?"` → `EXIT=1`.
Run: `./node_modules/.bin/vitest run --config vitest.config.ts tests/unit/share-link-single-exception.test.ts; echo "EXIT=$?"` → `EXIT=1` (the offender list no longer matches).

- [ ] **Step 3: The service**

In `document-share-service.ts`, move the validity steps of `readShared` (from `repositories.shareLinks.findByToken(token)` to `if (!verdict.valid) throw new ShareLinkNotFoundError();`) into a private method, and call it from both readers:

```ts
  /** One evaluation for the page and its images, so the two cannot drift apart. */
  private async validLink(repositories: KnowledgeRepositories, token: string, now: Date) {
    const link = await repositories.shareLinks.findByToken(token);
    if (!link) throw new ShareLinkNotFoundError();
    const document = await repositories.documents.findById(link.documentId);
    if (!document) throw new ShareLinkNotFoundError();
    const source = await repositories.sourcePolicy.findById(document.sourceId);
    if (!source) throw new ShareLinkNotFoundError();
    const workspace = await repositories.workspaces.findById(source.workspaceId);
    if (!workspace) throw new ShareLinkNotFoundError();
    const membership = await repositories.workspaceMemberships.find(workspace.id, link.createdBy);
    const verdict = evaluateShareLinkValidity({
      link,
      documentStatus: document.status,
      sourceStatus: source.status,
      workspaceLifecycle: workspace.lifecycleState,
      creatorDirectRole: membership ? membership.role ?? null : undefined,
      now,
    });
    if (!verdict.valid) throw new ShareLinkNotFoundError();
    return { link, document };
  }
```

`readShared`'s transaction body becomes `const { link, document } = await this.validLink(repositories, token, now);` followed by its existing revision and creator reads, unchanged. Then add:

```ts
  /**
   * An image the shared page draws (folder-sync images spec §6.4). The token
   * grants the images its document's current revision writes and no other
   * file: without that test a holder could walk the folder by guessing paths.
   * Like readShared, every failure is the same ShareLinkNotFoundError, and it
   * records no view: a view is a page load.
   */
  async readSharedImage(token: string, src: string): Promise<StoredImage> {
    if (!isShareToken(token)) throw new ShareLinkNotFoundError();
    const now = this.clock();
    return this.unitOfWork.run(async (repositories) => {
      const { document } = await this.validLink(repositories, token, now);
      const image = await repositories.sourcePolicy.findStoredImage(document.id, src);
      if (!image) throw new ShareLinkNotFoundError();
      const revision = await repositories.revisions.findCurrent(document.id);
      if (!revision) throw new IntegrityViolationError("Document current revision is missing.");
      const drawn = extractImageSources(revision.markdown).some((written) => resolveImagePath(image.documentPath, written) === image.sourcePath);
      if (!drawn) throw new ShareLinkNotFoundError();
      return image;
    });
  }
```

Imports: `extractImageSources` from `@/shared/markdown/image-sources`, `resolveImagePath` from `@/shared/markdown/image-path`, `type StoredImage` from `../domain/source-policy`, `type KnowledgeRepositories` from `../ports/unit-of-work`.

- [ ] **Step 4: The web layer**

`src/server/composition.ts`: `shareReadService()` returns `Pick<DocumentShareService, "readShared" | "readSharedImage">`.

`src/server/share-read.ts`, append:

```ts
/** An image on a shared page. Null for every failure, as the page itself is. */
export async function getSharedImage(token: string, src: string): Promise<StoredImage | null> {
  try {
    return await shareReadService().readSharedImage(token, src);
  } catch (error) {
    if (!(error instanceof ShareLinkNotFoundError)) {
      console.error("Shared image could not be read.", error instanceof Error ? error.name : "UnknownError");
    }
    return null;
  }
}
```

with `import type { StoredImage } from "@/modules/knowledge/domain/source-policy";`.

`src/app/s/[token]/asset/route.ts`:

```ts
import { configuredBlobStore } from "@/server/blob-store";
import { imageResponse } from "@/server/document-images";
import { getSharedImage } from "@/server/share-read";

export const dynamic = "force-dynamic";

/** Folder-sync images spec §6.4: one 404 for every failure, so no response says whether a file exists. */
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const src = new URL(request.url).searchParams.get("src") ?? "";
  return imageResponse(request, await getSharedImage((await context.params).token, src), configuredBlobStore());
}
```

`src/app/s/[token]/page.tsx`: read the token once, `const { token } = await params; const shared = await getSharedDocument(token);`, and wrap the renderer **without changing its line** (a guard test matches it exactly):

```tsx
      <article className="kh-reading-column min-w-0 pb-6 pt-6 [&>div>:first-child]:mt-0">
        <MarkdownImageBaseProvider base={`/s/${token}/asset`}>
          <MarkdownRenderer markdown={shared.markdown} />
        </MarkdownImageBaseProvider>
      </article>
```

The `[&>div>:first-child]:mt-0` selector targets the renderer's wrapper `div` as a direct child of `article`; a context provider renders no element, so it still matches.

The `/s/:path*` rule in `next.config.ts` already sends `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store` and `X-Robots-Tag` for this route, and Task 5's rule adds the sandboxing policy. Shared images are therefore not revalidated with 304; they are refetched, which is what makes a revocation take effect at once.

- [ ] **Step 5: Amend the contract**

`CLAUDE.md`, in "Knowing an ID is not authorization", replace the sentence beginning "It is accepted by exactly one read path" through "never search, tree, history, MCP, or any write." with:

```text
  It is accepted by exactly two routes, the page `/s/:token` and the images
  that page draws, `/s/:token/asset` (through `DocumentShareService.readShared`
  and `readSharedImage`), and grants whoever holds it the current revision of
  one document and the images that revision references — never search, tree,
  history, MCP, any other file, or any write.
```

and change "No other code path may serve document content without a caller" to "No other code path may serve document content or image bytes without a caller".

`docs/superpowers/specs/2026-09-23-document-share-link-design.md`: at the top of §6.1 and of §6.2 add one line each:

```text
> **Amended 2026-10-08:** the page's images are a second caller-less route, `/s/:token/asset`, limited to the images the current revision draws. See `2026-10-08-folder-sync-images-design.md` §6.4.
```

- [ ] **Step 6: Run and see them pass**

Run both commands from Step 2 → `EXIT=0`.
Run: `./node_modules/.bin/vitest run --config vitest.integration.config.ts tests/integration/*share*.test.ts; echo "EXIT=$?"` → `EXIT=0`: the existing share-link suites prove `readShared` behaves as before the extraction.
Run: `make typecheck lint; echo "EXIT=$?"` → `EXIT=0`.

- [ ] **Step 7: Commit**

```bash
git add src/modules/knowledge/application/document-share-service.ts src/server/composition.ts src/server/share-read.ts "src/app/s/[token]" tests/unit/share-link-single-exception.test.ts tests/integration/folder-images-share.test.ts CLAUDE.md docs/superpowers/specs/2026-09-23-document-share-link-design.md
git commit -m "feat(images): a shared page shows the images its document draws"
```

---

### Task 8: The browser sends the images

**Files:**
- Modify: `src/components/imports/folder-import-form.tsx` (`ImportUiState` near line 37, the text function near line 420, `busy` near line 489, `runFolderImport` near lines 383-387; new `uploadImages` after `uploadMarkdownBatches`)
- Test: `tests/unit/folder-import-images.test.ts`

**Interfaces:**
- Consumes: `assetUploads: string[]` in the create response; `PUT /api/source-imports/:snapshotId/asset?uploadKey=` (Task 3)
- Produces: `ImportUiState` member `{ kind: "UPLOADING_IMAGES"; uploaded: number; total: number }`

- [ ] **Step 1: Write the failing test**

`tests/unit/folder-import-images.test.ts`:

```ts
import { afterEach, expect, it, vi } from "vitest";
import { runFolderImport } from "@/components/imports/folder-import-form";

const target = { kind: "new", workspaceId: "workspace" } as const;
const file = (relativePath: string, content: string) => {
  const created = new File([content], relativePath.split("/").pop()!);
  Object.defineProperty(created, "webkitRelativePath", { value: relativePath });
  return created;
};
const json = (body: unknown, status = 200) => Response.json(body, { status });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function stubServer(assetUploads: (manifest: { uploadKey: string; relativePath: string }[]) => string[], assetStatus = 200) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input), method = init.method ?? "GET";
    calls.push({ method, url, body: init.body });
    if (url.endsWith("/source-imports")) return json({ snapshotId: "snap", state: "BUILDING", assetUploads: assetUploads(JSON.parse(String(init.body)).manifest) });
    if (url.includes("/asset?")) return assetStatus === 200 ? json({ accepted: true }) : json({ error: { code: "UPLOAD_SIZE_MISMATCH", message: "mismatch" } }, assetStatus);
    if (method === "DELETE") return json({ abandoned: true });
    return json({});
  }));
  return calls;
}
const folder = () => [file("wiki/guide.md", "# Guide"), file("wiki/img/a b.png", "aaa"), file("wiki/img/c.png", "ccc"), file("wiki/notes.pdf", "pdf")];

it("uploads exactly the images the server asked for, after Markdown and before finalize", async () => {
  const calls = stubServer((manifest) => manifest.filter((entry) => entry.relativePath.endsWith("a b.png")).map((entry) => entry.uploadKey));
  const states: { kind: string }[] = [];
  await runFolderImport({ target, files: folder(), sourceName: "Wiki", onProgress: (state) => states.push(state) });
  const order = calls.map((call) => call.url.includes("/asset?") ? "asset" : call.url.split("/").pop());
  expect(order).toEqual(["source-imports", "entries", "asset", "finalize"]);
  const asset = calls.find((call) => call.url.includes("/asset?"))!;
  expect(asset.method).toBe("PUT");
  expect(new URL(asset.url, "http://hub.test").searchParams.get("uploadKey")).toMatch(/a b\.png$/);
  expect(await (asset.body as File).text()).toBe("aaa");
  expect(states.filter((state) => state.kind === "UPLOADING_IMAGES")).toEqual([
    { kind: "UPLOADING_IMAGES", uploaded: 0, total: 1 }, { kind: "UPLOADING_IMAGES", uploaded: 1, total: 1 },
  ]);
});
it("uploads nothing and shows no image step when the server asks for none", async () => {
  const calls = stubServer(() => []);
  const states: { kind: string }[] = [];
  await runFolderImport({ target, files: folder(), sourceName: "Wiki", onProgress: (state) => states.push(state) });
  expect(calls.some((call) => call.url.includes("/asset?"))).toBe(false);
  expect(states.some((state) => state.kind === "UPLOADING_IMAGES")).toBe(false);
});
it("an older server that returns no assetUploads still imports", async () => {
  const calls = stubServer(() => undefined as unknown as string[]);
  await runFolderImport({ target, files: folder(), sourceName: "Wiki", onProgress: vi.fn() });
  expect(calls.map((call) => call.url.split("/").pop())).toEqual(["source-imports", "entries", "finalize"]);
});
it("a rejected image stops the import with the server's code, abandons the snapshot and never finalizes", async () => {
  const calls = stubServer((manifest) => manifest.filter((entry) => entry.relativePath.endsWith(".png")).map((entry) => entry.uploadKey), 400);
  await expect(runFolderImport({ target, files: folder(), sourceName: "Wiki", onProgress: vi.fn() })).rejects.toMatchObject({ code: "UPLOAD_SIZE_MISMATCH" });
  expect(calls.some((call) => call.url.endsWith("/finalize"))).toBe(false);
  expect(calls.some((call) => call.method === "DELETE" && call.url.endsWith("/source-imports/snap"))).toBe(true);
});
```

- [ ] **Step 2: Run and see it fail**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts tests/unit/folder-import-images.test.ts; echo "EXIT=$?"` → `EXIT=1`.

- [ ] **Step 3: Implement**

In `folder-import-form.tsx`:

Add to the `ImportUiState` union: `| { kind: "UPLOADING_IMAGES"; uploaded: number; total: number }`.

In the function that turns a state into text (line ~420), after the `UPLOADING` line: `if (state.kind === "UPLOADING_IMAGES") return `Uploading images… ${state.uploaded}/${state.total}`;`

In `busy` (line ~489) add `|| state.kind === "UPLOADING_IMAGES"`. Run `./node_modules/.bin/tsc --noEmit -p .` and handle the new kind wherever the compiler reports a non-exhaustive match.

After `uploadMarkdownBatches`:

```ts
/**
 * Sends the images the server asked for, a few at a time. The server names
 * them: it skips one this folder's source already stores, and asks for none
 * when it keeps images as references only.
 */
async function uploadImages(
  snapshotId: string,
  staged: StagedFile[],
  uploadKeys: readonly string[],
  onProgress: (uploaded: number, total: number) => void,
  assertAllowed: () => void,
  signal?: AbortSignal,
): Promise<void> {
  const byKey = new Map(staged.map((entry) => [entry.uploadKey, entry]));
  const wanted = uploadKeys.flatMap((key) => byKey.get(key) ?? []);
  let next = 0;
  let uploaded = 0;
  onProgress(0, wanted.length);
  const worker = async (): Promise<void> => {
    while (next < wanted.length) {
      const entry = wanted[next++];
      assertAllowed();
      const response = await fetchWithTransientRetry(
        `/api/source-imports/${snapshotId}/asset?uploadKey=${encodeURIComponent(entry.uploadKey)}`,
        { method: "PUT", body: entry.file, signal },
        async (response) => response,
        assertAllowed,
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (response.status !== 404) requestWorkspaceAccessCheck(response.status, readErrorEnvelope(body)?.code);
        const failure = readErrorCode(body, "Uploading an image failed.");
        throw Object.assign(new Error(failure.message), { code: failure.code });
      }
      uploaded += 1;
      onProgress(uploaded, wanted.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(ASSET_HASH_CONCURRENCY, wanted.length) }, worker));
}
```

In `runFolderImport`, read the list next to `snapshotId`:

```ts
  const assetUploads = (session.body as { assetUploads?: unknown }).assetUploads;
  const imageKeys = Array.isArray(assetUploads) ? assetUploads.filter((key): key is string => typeof key === "string") : [];
```

and between the Markdown upload and `onProgress({ kind: "FINALIZING", ...` insert:

```ts
    if (imageKeys.length > 0) {
      assertAllowed();
      await uploadImages(snapshotId, selection.staged, imageKeys, (uploaded, total) =>
        onProgress({ kind: "UPLOADING_IMAGES", uploaded, total }), assertAllowed, signal,
      );
    }
```

Update the doc comment above `runFolderImport` to list `PUT /api/source-imports/:snapshotId/asset`.

- [ ] **Step 4: Run and see it pass**

Run the Step 2 command → `EXIT=0`.
Run: `./node_modules/.bin/vitest run --config vitest.config.ts tests/unit/folder-import-*.test.ts*; echo "EXIT=$?"` → `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/components/imports/folder-import-form.tsx tests/unit/folder-import-images.test.ts
git commit -m "feat(images): the import form uploads the images the server asks for"
```

---

### Task 9: Clean up unreferenced blobs and find missing ones

**Files:**
- Create: `src/modules/sources/application/blob-maintenance.ts`, `scripts/storage/blobs.ts`
- Modify: `src/modules/sources/ports/asset-repository.ts`, `src/infrastructure/database/mariadb/repositories/assets.ts`, `src/modules/sources/ports/import-snapshot-entry-repository.ts`, `src/infrastructure/database/mariadb/repositories/import-snapshot-entries.ts`, `src/server/composition.ts`, `src/server/source-imports.ts`, `package.json` (scripts), `Makefile`
- Test: `tests/integration/folder-images-maintenance.test.ts`

**Interfaces:**
- Consumes: `BlobStore.list/remove/has` (Task 2); `isStoredImage` (Task 3)
- Produces:
  - `AssetRepository.listStored(): Promise<KnowledgeAsset[]>`, `AssetRepository.clearStored(assetId: string): Promise<void>`
  - `ImportSnapshotEntryRepository.listActiveAssetHashes(): Promise<string[]>`
  - `BlobMaintenanceService` with `gc(): Promise<{ removed: number }>` and `verify(options?: { repair?: boolean }): Promise<{ missing: { assetId: string; sourceId: string; sourcePath: string }[] }>`; `applicationServices().blobMaintenance: BlobMaintenanceService | null`
  - `make blobs-gc`, `make blobs-verify`

- [ ] **Step 1: Write the failing tests**

`tests/integration/folder-images-maintenance.test.ts`. Copy the import block and the three hooks from `folder-images-import.test.ts` verbatim; import `png`, `sha256`, `stream`, `stageImageImport`, `prepareImageImport` from `../fixtures/folder-images`, `utimes` from `node:fs/promises`, and `BlobMaintenanceService` from `@/modules/sources/application/blob-maintenance`. Then:

```ts
const blobFile = (hash: string) => path.join(root, "sha256", hash.slice(0, 2), hash.slice(2, 4), hash);
const age = async (hash: string, hours: number) => { const when = new Date(Date.now() - hours * 3600_000); await utimes(blobFile(hash), when, when); };
const orphan = async (seed: string, hours: number) => { const bytes = png(seed); await blobs.put(sha256(bytes), stream(bytes), bytes.byteLength); await age(sha256(bytes), hours); return sha256(bytes); };
const files = [{ path: "guide.md", text: "# Guide\n![d](img/d.png)" }, { path: "img/d.png", bytes: png("kept") }];

it("removes only blobs that are old and referenced by nothing", async () => {
  const applied = await s.imports.apply.apply(fixtureCaller(), (await prepareImageImport(uow, blobs, ws, null, files)).snapshotId);
  expect(applied.kind).toBe("APPLIED");
  const staged = await prepareImageImport(uow, blobs, ws, null, [{ path: "a.md", text: "# A" }, { path: "p.png", bytes: png("staged") }]);
  expect(staged.assetUploads).toHaveLength(1);
  await age(sha256(png("kept")), 100);
  await age(sha256(png("staged")), 100);
  const oldOrphan = await orphan("old-orphan", 49);
  const youngOrphan = await orphan("young-orphan", 47);
  expect(await new BlobMaintenanceService(uow, blobs).gc()).toEqual({ removed: 1 });
  expect(await blobs.has(oldOrphan)).toBe(false);
  expect(await blobs.has(youngOrphan)).toBe(true);
  expect(await blobs.has(sha256(png("kept")))).toBe(true);
  expect(await blobs.has(sha256(png("staged")))).toBe(true);
});
it("reports stored images whose bytes are gone, and repairs them so the next sync re-uploads", async () => {
  const applied = await s.imports.apply.apply(fixtureCaller(), (await prepareImageImport(uow, blobs, ws, null, files)).snapshotId);
  if (applied.kind !== "APPLIED") throw Error("fixture");
  const maintenance = new BlobMaintenanceService(uow, blobs);
  expect((await maintenance.verify()).missing).toEqual([]);
  await blobs.remove(sha256(png("kept")));
  const report = await maintenance.verify();
  expect(report.missing).toMatchObject([{ sourceId: applied.sourceId, sourcePath: "img/d.png" }]);
  // Without repair the source still claims the hash, so a sync asks for no bytes and the image stays broken.
  expect((await stageImageImport(uow, blobs, ws, applied.sourceId, files)).assetUploads).toEqual([]);
  await maintenance.verify({ repair: true });
  const next = await stageImageImport(uow, blobs, ws, applied.sourceId, files);
  expect(next.assetUploads).toEqual(["f1"]);
});
```

- [ ] **Step 2: Run and see it fail**

Run: `./node_modules/.bin/vitest run --config vitest.integration.config.ts tests/integration/folder-images-maintenance.test.ts; echo "EXIT=$?"` → `EXIT=1`.

- [ ] **Step 3: Repository methods**

`asset-repository.ts`:

```ts
  /** Every asset row whose bytes are claimed to be in the blob store. */
  listStored(): Promise<KnowledgeAsset[]>;
  /** Forget that an asset's bytes are stored, so its next sync uploads them again. */
  clearStored(assetId: string): Promise<void>;
```

`assets.ts`:

```ts
  async listStored(): Promise<KnowledgeAsset[]> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM knowledge_assets WHERE content_hash IS NOT NULL AND JSON_CONTAINS(metadata,'true','$.stored') ORDER BY source_id, source_path");
    return rows.map(mapAsset);
  }

  async clearStored(assetId: string): Promise<void> {
    await this.connection.query("UPDATE knowledge_assets SET metadata = JSON_REMOVE(metadata,'$.stored') WHERE id = ?", [assetId]);
  }
```

`import-snapshot-entry-repository.ts`:

```ts
  /** Asset hashes in snapshots that may still be finalized or applied. */
  listActiveAssetHashes(): Promise<string[]>;
```

`import-snapshot-entries.ts`:

```ts
  async listActiveAssetHashes(): Promise<string[]> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT DISTINCT e.asset_content_hash hash FROM source_import_snapshot_entries e
       JOIN source_import_snapshots s ON s.id = e.snapshot_id
       WHERE e.entry_type = 'ASSET' AND e.asset_content_hash IS NOT NULL AND s.state IN ('BUILDING','READY')`,
    );
    return rows.map((row) => String(row.hash));
  }
```

- [ ] **Step 4: The service**

`src/modules/sources/application/blob-maintenance.ts`:

```ts
import { isStoredImage } from "@/modules/sources/domain/stored-image";
import type { BlobStore } from "@/modules/sources/ports/blob-store";
import type { SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";

/** Longer than any staging lifetime (24 h), so a blob uploaded for a preview is never young enough to lose. */
const GRACE_MS = 48 * 60 * 60 * 1000;

export class BlobMaintenanceService {
  constructor(private readonly uow: SourceUnitOfWork, private readonly blobs: BlobStore, private readonly now: () => Date = () => new Date()) {}

  /** Removes blobs that no stored asset and no live snapshot refers to, once they are older than the grace period. */
  async gc(): Promise<{ removed: number }> {
    const cutoff = this.now().getTime() - GRACE_MS;
    const referenced = await this.uow.run(async (repositories) => new Set([
      ...(await repositories.assets.listStored()).map((asset) => asset.contentHash!),
      ...(await repositories.importSnapshotEntries.listActiveAssetHashes()),
    ]));
    let removed = 0;
    for await (const blob of this.blobs.list()) {
      if (blob.modifiedAt.getTime() >= cutoff || referenced.has(blob.sha256)) continue;
      await this.blobs.remove(blob.sha256);
      removed += 1;
    }
    return { removed };
  }

  /** Stored images whose bytes are missing, for example after restoring the database without the volume. */
  async verify(options: { repair?: boolean } = {}): Promise<{ missing: { assetId: string; sourceId: string; sourcePath: string }[] }> {
    const stored = (await this.uow.run((repositories) => repositories.assets.listStored())).filter(isStoredImage);
    const missing = [];
    for (const asset of stored) {
      if (await this.blobs.has(asset.contentHash!)) continue;
      missing.push({ assetId: asset.id, sourceId: asset.sourceId, sourcePath: asset.sourcePath });
      if (options.repair) await this.uow.run((repositories) => repositories.assets.clearStored(asset.id));
    }
    return { missing };
  }
}
```

- [ ] **Step 5: Wire it and add the script**

`src/server/composition.ts`: add `blobMaintenance: blobs ? new BlobMaintenanceService(unitOfWork, blobs) : null,` to the returned object.

`src/server/source-imports.ts`: replace both `sweepImportStagingSoon(() => services.imports.cleanup.cleanup());` calls with `sweepImportStagingSoon(() => sweep(services));` and add:

```ts
/** Expired staging first: deleting it is what releases the blobs a preview was holding. */
async function sweep(services: ReturnType<typeof applicationServices>): Promise<{ deleted: number }> {
  const result = await services.imports.cleanup.cleanup();
  await services.blobMaintenance?.gc();
  return result;
}
```

`scripts/storage/blobs.ts` (open `scripts/db/cleanup-import-snapshots.ts` first and copy how it loads `dotenv` and builds its pool, so both scripts connect the same way):

```ts
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
```

`Makefile`, beside the existing database maintenance targets:

```make
.PHONY: blobs-gc
blobs-gc: ## Remove stored images nothing refers to (older than 48 h).
	npx tsx scripts/storage/blobs.ts gc

.PHONY: blobs-verify
blobs-verify: ## List stored images whose file is missing; `make blobs-verify REPAIR=1` re-uploads them on next sync.
	npx tsx scripts/storage/blobs.ts verify $(if $(REPAIR),--repair,)
```

- [ ] **Step 6: Run and see it pass**

Run the Step 2 command → `EXIT=0`.
Run: `./node_modules/.bin/vitest run --config vitest.config.ts tests/unit/import-staging-sweep.test.ts; echo "EXIT=$?"` → `EXIT=0`.
Run: `./node_modules/.bin/tsc --noEmit -p .; echo "EXIT=$?"` → `EXIT=0`; add the new repository methods to any test double the compiler names.

- [ ] **Step 7: Commit**

```bash
git add src/modules/sources src/infrastructure/database/mariadb/repositories src/server/composition.ts src/server/source-imports.ts scripts/storage Makefile tests/integration/folder-images-maintenance.test.ts
git commit -m "feat(images): sweep unreferenced blobs and report missing ones"
```

---

### Task 10: End to end, documentation, and the full gate

**Files:**
- Create: `tests/e2e/zz-folder-images.spec.ts`
- Modify: `scripts/test/e2e.ts`, `README.md`, `README.zh-TW.md`, `src/components/imports/import-guide-content.ts`, `src/components/help/user-guide-content.ts`, `tests/unit/import-guide-content.test.ts`, `docs/superpowers/specs/2026-09-12-phase-2-knowledge-source-import-sync-design.md` (§5.4, §12), `docs/superpowers/specs/2026-10-08-folder-sync-images-design.md` (Status)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Give the e2e server an image volume**

In `scripts/test/e2e.ts`: add `"KM_BLOB_DIR"` to the `environmentNames` list (lines 16-19), and where the run assigns the database variables for the spawned server (around lines 121-130) add:

```ts
      process.env.KM_BLOB_DIR = await mkdtemp(path.join(tmpdir(), "km-e2e-blobs-"));
```

with `mkdtemp` from `node:fs/promises` and `tmpdir` from `node:os`. Remove the directory where the run disposes of its database.

- [ ] **Step 2: Write the e2e test**

`tests/e2e/zz-folder-images.spec.ts`:

```ts
import { createHash } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";

// A real 1×1 PNG, so the browser decodes it and naturalWidth proves it loaded.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><script>document.title="pwned"</script><rect width="4" height="4"/></svg>');
// In the folder, drawn by no page. It only has to be stored, not decoded.
const SECRET = Buffer.from("an image no document refers to");
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const MARKDOWN = Buffer.from("# Picture guide\n\n![pixel](img/pixel.png)\n\n![vector](img/vector.svg)\n");
const files = [
  { key: "m0", path: "picture-guide.md", bytes: MARKDOWN, markdown: true },
  { key: "a1", path: "img/pixel.png", bytes: PNG, markdown: false },
  { key: "a2", path: "img/vector.svg", bytes: SVG, markdown: false },
  { key: "a3", path: "img/secret.png", bytes: SECRET, markdown: false },
];

async function importFolder(request: APIRequestContext, workspaceId: string) {
  const manifest = files.map((file) => file.markdown
    ? { uploadKey: file.key, relativePath: file.path, kind: "MARKDOWN", size: file.bytes.length }
    : { uploadKey: file.key, relativePath: file.path, kind: "ASSET", size: file.bytes.length, contentHash: sha(file.bytes), mimeType: null, lastModified: null });
  const created = await request.post(`/api/workspaces/${workspaceId}/source-imports`, { data: { sourceName: "Picture folder", rootName: "pictures", manifest } });
  expect(created.ok()).toBe(true);
  const { snapshotId, assetUploads } = await created.json();
  expect([...assetUploads].sort()).toEqual(["a1", "a2", "a3"]);
  expect((await request.post(`/api/source-imports/${snapshotId}/entries`, { multipart: { entries: JSON.stringify([{ uploadKey: "m0", field: "file-0" }]), "file-0": { name: "picture-guide.md", mimeType: "text/markdown", buffer: MARKDOWN } } })).ok()).toBe(true);
  // Finalize must refuse while an image is outstanding.
  expect((await request.post(`/api/source-imports/${snapshotId}/finalize`, { data: {} })).ok()).toBe(false);
  for (const file of files.filter((candidate) => !candidate.markdown)) {
    const sent = await request.put(`/api/source-imports/${snapshotId}/asset?uploadKey=${file.key}`, { data: file.bytes, headers: { "Content-Type": "application/octet-stream" } });
    expect(sent.ok(), file.path).toBe(true);
  }
  expect((await request.post(`/api/source-imports/${snapshotId}/finalize`, { data: {} })).ok()).toBe(true);
  const applied = await request.post(`/api/source-imports/${snapshotId}/apply`, { data: {} });
  expect(applied.ok()).toBe(true);
  return (await applied.json()).sourceId as string;
}

test("a synced folder's images show to its reader and on a shared page, and nowhere else", async ({ page, request, browser }) => {
  const nav = await (await request.get("/api/workspaces")).json();
  const ws = nav.items.find((workspace: { type: string }) => workspace.type === "PERSONAL").id;
  const sourceId = await importFolder(request, ws);

  await page.goto(`/w/${ws}/knowledge/${sourceId}`);
  await expect(page.getByRole("heading", { name: "Picture guide", level: 1 })).toBeVisible();
  const pixel = page.getByRole("img", { name: "pixel" });
  await expect(pixel).toBeVisible();
  await expect.poll(() => pixel.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  await expect.poll(() => page.getByRole("img", { name: "vector" }).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(4);
  const documentId = page.url().split("/").pop()!.split("?")[0];

  const direct = await request.get(`/api/documents/${documentId}/asset?src=${encodeURIComponent("img/vector.svg")}`);
  expect(direct.status()).toBe(200);
  expect(direct.headers()).toMatchObject({ "content-type": "image/svg+xml", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
  expect((await request.get(`/api/documents/${documentId}/asset?src=${encodeURIComponent("img/vector.svg")}`, { headers: { "If-None-Match": direct.headers().etag } })).status()).toBe(304);
  // Opened as a page, the SVG's script must not run.
  await page.goto(`/api/documents/${documentId}/asset?src=${encodeURIComponent("img/vector.svg")}`);
  expect(await page.title()).not.toBe("pwned");

  const shareResponse = await request.post(`/api/documents/${documentId}/share-links`, { data: { label: "Pictures" } });
  expect(shareResponse.ok()).toBe(true);
  const share = await shareResponse.json();
  const token = String(share.token ?? new URL(share.url, "http://hub.test").pathname.split("/").pop());

  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const visitor = await anonymous.newPage();
  await visitor.goto(`/s/${token}`);
  await expect.poll(() => visitor.getByRole("img", { name: "pixel" }).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  const sharedImage = await anonymous.request.get(`/s/${token}/asset?src=${encodeURIComponent("img/vector.svg")}`);
  expect(sharedImage.status()).toBe(200);
  expect(sharedImage.headers()).toMatchObject({ "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox", "referrer-policy": "no-referrer" });
  // In the folder, not on the page: the token does not reach it.
  expect((await anonymous.request.get(`/s/${token}/asset?src=${encodeURIComponent("img/secret.png")}`)).status()).toBe(404);

  const linkId = String(share.id ?? share.linkId);
  expect((await request.delete(`/api/share-links/${linkId}`)).ok()).toBe(true);
  expect((await anonymous.request.get(`/s/${token}/asset?src=${encodeURIComponent("img/pixel.png")}`)).status()).toBe(404);
  await anonymous.close();
});
```

Before running, confirm three names against the code and fix the test, not the product, if they differ: the share-link create response's field for the token (`src/app/api/documents/[documentId]/share-links/route.ts`), the revoke route (`find src/app/api/share-links -name route.ts`), and whether opening `/w/:ws/knowledge/:sourceId` redirects to the folder's first document (it does for a one-document folder; see `tests/e2e/router-redirect-during-navigation.spec.ts`).

- [ ] **Step 3: Run it**

Run: `./node_modules/.bin/tsx scripts/test/e2e.ts tests/e2e/zz-folder-images.spec.ts > "${CLAUDE_JOB_DIR:-/tmp}/km-e2e.log" 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`, `1 passed`. If documents hang on "Loading document" with `PROBE-NEXT` console lines, move `.next/cache` aside and run again; that is a stale build cache, not this change.

The e2e server signs every request in as the local test identity, so this test cannot show a signed-out visitor being refused by `/api/documents/:id/asset`; `folder-images-read.test.ts` covers that with a caller who is not a member.

If the header assertions fail with the page's `img-src 'self'` policy, the two rules from Task 5 Step 6 are not last in `headers()`; move them to the end and re-run.

- [ ] **Step 4: Documentation**

`README.md`:
- Feature table, "Import and sync" row: append "; images in the folder are stored and shown when the server has an image volume (`KM_BLOB_DIR`)".
- Configuration table: add a row `| `KM_BLOB_DIR` | Directory on a persistent volume where synced folders' images are stored. Unset keeps images as references only. The server refuses to start if it is set and not a writable directory. |`
- After the import-limits paragraph add:

```markdown
### Images

With `KM_BLOB_DIR` set, a folder's `png`, `jpg`, `jpeg`, `gif`, `webp`, `avif` and `svg` files are uploaded at import and shown in documents and on shared pages. A source imported before the setting was added gets its images on its next sync. Images written as Obsidian embeds (`![[image.png]]`) are not shown; use `![alt](path)`. An image has no history: an older revision shows the folder's current file.

Back up the database first and the image directory second. Files are only added, so a directory copied after the database holds everything the database refers to. After a restore, `make blobs-verify` lists images whose file is missing and `make blobs-verify REPAIR=1` makes the next sync upload them again. `make blobs-gc` removes files nothing refers to; the server also does this in the background.

One application server per image directory. Several servers need a shared filesystem.
```

- Troubleshooting list, the "Links or graph entries are missing" neighbourhood: add "**Images do not appear**: check `KM_BLOB_DIR` is set, sync the folder again, and run `make blobs-verify`."

Mirror each change in `README.zh-TW.md`.

`src/components/imports/import-guide-content.ts`: the guide receives the server's limits as `limits`. Add `imagesStored: boolean` to `GuideLimits`, pass `configuredBlobStore() !== null` where the guide page builds its limits, and make the two sentences conditional, in both `english` and the Traditional Chinese function:

```ts
            text: limits.imagesStored
              ? "Obsidian's `[[wikilinks]]` are understood, including a path-qualified form `[[folder/Note]]`. Images written as `![alt](path)` are stored and shown; Obsidian embeds (`![[image.png]]`) and other attachments are recorded as references only."
              : "Obsidian's `[[wikilinks]]` are understood, including a path-qualified form `[[folder/Note]]`. Images and other attachments are recorded as references only (see Limits).",
```

```ts
              limits.imagesStored
                ? "Images as `![alt](path)` with a `png`, `jpg`, `jpeg`, `gif`, `webp`, `avif` or `svg` file inside the folder. Other attachments are kept as references only."
                : "No attachments to rely on: images and other non-Markdown files are kept as references only; there is no binary attachment storage.",
```

Traditional Chinese, same two places:

```ts
              ? "可以辨識 Obsidian 的 `[[wikilinks]]`，包含帶路徑的寫法 `[[folder/Note]]`。以 `![alt](path)` 寫的圖片會被儲存並顯示；Obsidian 的嵌入語法（`![[image.png]]`）與其他附件只會記錄參照。"
```

```ts
                ? "圖片請用 `![alt](path)`，檔案為資料夾內的 `png`、`jpg`、`jpeg`、`gif`、`webp`、`avif` 或 `svg`。其他附件只會保留參照。"
```

keeping the existing Chinese sentences as the `: ` branches. In `tests/unit/import-guide-content.test.ts` add `imagesStored: false` to the limits the existing cases pass, and one case per language asserting the `imagesStored: true` text contains `![alt](path)` and does not contain "no binary attachment storage" / "不提供".

`src/components/help/user-guide-content.ts`, both languages, replace the sentence that begins "Unresolved links or missing images" / its Chinese counterpart with one that says: images written as `![alt](path)` appear when the server stores images; if they do not, sync the folder again; Obsidian embeds and other attachments keep references only.

`docs/superpowers/specs/2026-09-12-phase-2-knowledge-source-import-sync-design.md`: at the top of §5.4 and §12 add

```text
> **Amended 2026-10-08:** image assets carry bytes when the server has an image store. See `2026-10-08-folder-sync-images-design.md`.
```

`docs/superpowers/specs/2026-10-08-folder-sync-images-design.md`: change Status to "Implemented." followed by the list of files and tests this plan created.

- [ ] **Step 5: The full gate**

```bash
export PATH=/Users/chuntsai/.nvm/versions/node/v24.6.0/bin:$PATH
make verify > "${CLAUDE_JOB_DIR:-/tmp}/km-verify.log" 2>&1; echo "VERIFY=$?"
make test-integration > "${CLAUDE_JOB_DIR:-/tmp}/km-int.log" 2>&1; echo "INT=$?"
make test-e2e > "${CLAUDE_JOB_DIR:-/tmp}/km-e2e-all.log" 2>&1; echo "E2E=$?"
```

Expected: all three `=0`. Read the logs for the pass counts; do not report success from an exit code alone when a pipe was involved.

Then by hand, with `KM_BLOB_DIR` pointing at a scratch directory and `make dev`: import a folder with images through the form and watch "Uploading images… n/m"; open a document; share it and open the link in a private window; unset `KM_BLOB_DIR`, restart, and confirm the import form uploads no images and existing pages show the "Image unavailable" placeholder.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/zz-folder-images.spec.ts scripts/test/e2e.ts README.md README.zh-TW.md src/components/imports/import-guide-content.ts src/components/help/user-guide-content.ts tests/unit/import-guide-content.test.ts docs/superpowers/specs
git commit -m "docs(images): configuration, backup and limits; e2e for stored images"
```

---

## Self-review

| Spec section | Task |
| --- | --- |
| §3.1 port, §3.2 adapter, `KM_BLOB_DIR` unset / unusable | 2 |
| §4 data model (no migration; existing columns) | 3, 4 |
| §5.1 image types by extension | 1, 3 |
| §5.2 upload, proof of possession, same-source exemption | 3 |
| §5.3 finalize blocks; never-stored image reconciles as a change | 4 |
| §6.1 endpoint, authorization, headers, ETag | 5 |
| §6.2 renderer | 6 |
| §6.3 history shows today's image | 5 (resolution is at read time against current assets; no task stores per-revision images) |
| §6.4 shared pages; §8.1 contract amendment | 7 |
| §7 gc, verify, backup, disk full (507) | 9, 3 (507), 10 (backup text) |
| §8 compatibility | 2 (off when unset), 4 (next sync stores), 8 (older server) |
| §9 tests | each task; e2e in 10 |

Names used across tasks: `imageContentType`, `resolveImagePath`, `extractImageSources` (1); `BlobStore`, `BlobBody`, `BlobMismatchError`, `FilesystemBlobStore`, `configuredBlobStore` (2); `isStoredImage`, `needsImageBytes`, `assetUploads`, `markAssetReceived`, `UploadFolderImportAssetService`, `stageImageImport`, `prepareImageImport` (3); `StoredImage`, `findStoredImage`, `findByPath`, `DocumentImageService`, `imageResponse`, `IMAGE_HEADERS` (5); `MarkdownImageBaseProvider`, `imageUrl` (6); `readSharedImage`, `getSharedImage` (7); `listStored`, `clearStored`, `listActiveAssetHashes`, `BlobMaintenanceService` (9).

Known limits this plan accepts, each stated in the spec: a sync performed while `KM_BLOB_DIR` is unset clears the stored flag of that source's images (they upload again once it is set); `gc` reads its reference set once per run, so a blob that becomes referenced during the run is protected only by being re-uploaded, which refreshes its file; the start-up check cannot tell a mounted volume from a directory baked into the image.
