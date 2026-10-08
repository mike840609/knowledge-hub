# Folder Sync images: stored, authorized, rendered

| Item | Content |
| --- | --- |
| Date | 2026-10-08 |
| Type | Design specification |
| Why | A synced folder's images are recorded as references only (Phase 2 spec §5.4, §12; first-wave spec, "the user explicitly chose to defer images"). A reader who imports a vault with screenshots or diagrams gets a successful import and broken pages. It is the one gap in Folder Sync that damages content rather than convenience. |
| Related | `2026-09-12-phase-2-knowledge-source-import-sync-design.md` (§5.4 asset transport, §12 asset model), `2026-10-03-folder-sync-first-wave-design.md`, `2026-10-03-folder-import-reliability.md` (asset limits, retry), `2026-09-23-document-share-link-design.md`, `src/components/knowledge/markdown-image-policy.ts` |
| Status | Implemented (plan: `docs/superpowers/plans/2026-10-08-folder-sync-images.md`). Store: `src/modules/sources/ports/blob-store.ts`, `src/infrastructure/storage/filesystem-blob-store.ts`, `src/server/blob-store.ts`. Import: `create-folder-import.ts`, `upload-folder-import-asset.ts`, `finalize-folder-import.ts`, `PUT /api/source-imports/:snapshotId/asset`. Reading: `document-image-service.ts`, `src/server/document-images.ts`, `GET /api/documents/:documentId/asset`, `markdown-image-base.tsx`. Shared pages: `DocumentShareService.readSharedImage`, `GET /s/:token/asset`. Maintenance: `blob-maintenance.ts`, `scripts/storage/blobs.ts`. Tests: unit `image-path`, `image-sources`, `filesystem-blob-store`, `blob-store-config`, `stored-image`, `document-images`, `markdown-image-base`, `folder-import-images`, `share-link-single-exception`; integration `folder-images-import`, `-read`, `-share`, `-maintenance`; e2e `zz-folder-images.spec.ts`. |

## 1. What it delivers

1. Image files in a synced folder are uploaded during import and kept on a mounted volume.
2. A signed-in reader who may read a document sees the images it references, served through an endpoint that checks that right on every request.
3. A shared page (`/s/:token`) shows the images its document references, and nothing else from the folder.
4. A deployment that configures no volume behaves exactly as today.

Out of scope for this delivery, each with a reason in §10: Obsidian embeds (`![[image.png]]`), images in Hub-managed notes, non-image attachments, an S3-compatible store, and image diagnostics in Source health.

## 2. Bedrock constraints

These decide the design; everything after follows from them.

- **The database is the only store today.** Markdown and import staging live in MariaDB. There is no file or object store and no abstraction for one.
- **An image is not part of a revision.** A revision stores title, Markdown and metadata. `knowledge_assets` is the source's *current* projection: path → hash, replaced by each Apply, with no history.
- **The browser already hashes every asset** (SHA-256, at most four at a time) and the server already bounds them: 64 MiB each, 512 MiB per import.
- **Images load without a click.** `markdown-image-policy.ts` and `img-src 'self'` allow only same-origin image URLs, so an image must be served by the Hub itself.
- **Knowing an ID is not authorization.** No URL may be a capability. A hash is an ID.
- **A file write and a database commit cannot be one transaction.**

## 3. Storage

### 3.1 The port

`src/modules/sources/ports/blob-store.ts`:

```ts
interface BlobStore {
  put(sha256: string, bytes: ReadableStream<Uint8Array>, expectedSize: number): Promise<void>;
  open(sha256: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null>;
  has(sha256: string): Promise<boolean>;
  remove(sha256: string): Promise<void>;
  list(): AsyncIterable<{ sha256: string; modifiedAt: Date }>;
}
```

The key is the content's SHA-256. Content under a key never changes, so `put` of an existing key is a no-op and two documents that use one image store it once. An S3-compatible adapter can implement the same five operations later; moving stores is a copy, with no change to the database.

### 3.2 The filesystem adapter

`src/infrastructure/storage/filesystem-blob-store.ts`, wired in `src/server/composition.ts`.

- Root from `KM_BLOB_DIR`. A file lives at `<root>/sha256/<first 2 hex>/<next 2 hex>/<full hash>`. No name from the user ever reaches the filesystem, so there is no path to traverse.
- `put` streams to `<root>/tmp/<random>`, hashing and counting as it writes. If the hash or the size disagrees with what was declared it deletes the temp file and fails. Otherwise it flushes, then renames into place. A crash leaves a temp file, never a half-written image under a real key.
- `KM_BLOB_DIR` **unset**: the feature is off. Import records references only, as now, and Preview says so.
- `KM_BLOB_DIR` **set but missing or not writable**: the server refuses to start and names the path. This is the guard against a container that was deployed without its volume, which would otherwise accept images into a layer that disappears on the next deploy.

One process, one disk. Several application servers need a shared filesystem or the S3 adapter; the README will say so.

## 4. Data model

No migration. Two facts need recording, and both fit columns that exist:

- **"This asset's bytes are in the store"** is `knowledge_assets.metadata.stored = true`. Every existing row lacks it. Because the reconciler already compares asset metadata, a reference-only image and the same image with bytes differ, so the sync that first stores it shows it as an updated asset with no reconciler change.
- **"This snapshot's creator sent bytes matching the declared hash"** is the staged entry's `upload_status = 'RECEIVED'` with `source_file_hash` equal to its `asset_content_hash`. An image entry starts `PENDING`, as Markdown entries do. §5.2 explains why `BlobStore.has` cannot stand in for this.

No table for revisions ↔ images, and no asset history. §6.3 states the consequence.

## 5. Import

### 5.1 Which files

An asset is an **image** when its extension is one of `png jpg jpeg gif webp avif svg` (case-insensitive). The server decides from the path; the browser's MIME hint is ignored. Every other asset stays reference-only.

Existing limits apply unchanged (`KM_IMPORT_MAX_ASSET_FILE_BYTES`, `KM_IMPORT_MAX_ASSET_TOTAL_BYTES`). No new limit.

### 5.2 Upload

When the store is configured, the create response lists, as `assetUploads`, the upload keys of the image entries whose bytes the server needs: every non-empty image **except** one where this same source already stores that hash.

```text
PUT /api/source-imports/:snapshotId/asset?uploadKey=<key>      body: the file's bytes
```

- Caller must be the snapshot's creator and the snapshot `BUILDING`, the same checks the Markdown upload route makes.
- The body is streamed into `BlobStore.put` with the entry's declared hash and size, outside any database transaction. On success the entry is marked received with its proven hash. Repeating the request is harmless.
- The client sends images after Markdown, at most four at a time, through the retry and cancel logic of the reliability spec.

**Why the server does not skip an upload because the blob already exists.** The store is shared by every workspace. If "the store has this hash" were enough, a caller could declare the hash of a file they do not possess and then read that file through their own source. Bytes are required unless the *same source* already stores that hash. Disk space is still shared; proof of possession is not.

### 5.3 Finalize, Preview, Apply

- **Finalize** blocks with the existing `UPLOAD_INCOMPLETE` while any entry, Markdown or image, is not received.
- **Reconcile** is unchanged. An image that is referenced but was never stored differs in metadata from the incoming one, so Preview lists it under updated assets. Without that, a source imported before this feature would report "no changes" forever and never receive its images.
- **Preview** is unchanged; its asset counts already include these. The import form shows "Uploading images… n/m", and the import guide says whether this server stores images.
- **Apply** is unchanged: it upserts the asset rows, whose metadata now carries `stored`. Files are written before the commit and never after it, so a commit can never refer to bytes that were not written. Apply does not re-check that each blob exists: cleanup cannot remove a blob a live snapshot refers to (§7).

## 6. Reading

### 6.1 The endpoint

```text
GET /api/documents/:documentId/asset?src=<the image's src, as written>
```

1. Authorize the caller to read the document, by the policy `KnowledgeQueryService.getDocument` applies. No caller, or no right: the same response as for the document.
2. Resolve `src` against the document's source path: URL-decode, treat a leading `/` as the source root, normalise `.` and `..`, reject anything that leaves the root.
3. Look the path up in `knowledge_assets` for **the document's own source**. Not found, not an image type, or not stored: 404.
4. Stream the blob.

The service lives in the `sources` module and takes a `CallerContext`. The URL carries a document ID and a path, neither of which grants anything; the check in step 1 does.

Response headers:

```text
Content-Type: from the extension table in §5.1
X-Content-Type-Options: nosniff
Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox
Content-Disposition: inline
ETag: "<sha256>"
Cache-Control: private, no-cache
```

`no-cache` with an ETag means every load re-checks authorization and usually answers 304. The URL is a path, and the image at a path can change, so it cannot be cached as immutable. The CSP and `nosniff` are what make serving SVG acceptable: opened directly, it runs no script.

### 6.2 The renderer

`MarkdownImage` reads an image base from context: a document ID in the workbench, a share token on a shared page (§6.4). An allowed relative `src` is rewritten to the matching endpoint; an absolute same-origin URL is left alone; everything the policy blocks stays blocked. With no base in context a `src` is written as it is today, so nothing that renders Markdown outside a document changes.

`markdown-image-policy.ts` and `img-src 'self'` do not change.

### 6.3 History shows today's image

Resolution happens at read time against the source's current assets, the rule links already follow. An old revision that says `![](diagram.png)` shows the `diagram.png` the folder has now, or the placeholder if it is gone. This is a deliberate limit: keeping every past image for every past revision means an asset history table and blobs that can never be deleted.

### 6.4 Shared pages

```text
GET /s/:token/asset?src=<the image's src, as written>
```

A share link is the one bearer grant in the system, so this is the part of the design with the least room for error. The rule: **the token grants the images the shared revision draws, and no other file.**

`DocumentShareService.readSharedImage(token, src)`:

1. Evaluates the link exactly as `readShared` does (token shape, expiry, revocation, document, source and workspace state, the creator's membership), through one shared private step so the two cannot drift. It runs on every image request, so revoking a link stops its images on the next load.
2. Reads the document's **current** revision and extracts the image sources its Markdown writes, with a pure function in `src/shared/markdown` that uses the renderer's parser. `src` must resolve to the same path as one of them. This is what stops a token holder from walking the folder by guessing paths: an image the page does not draw is not served, even if it sits beside one that is.
3. Resolves that path to a stored image in the document's own source through a knowledge port, implemented beside the resolver §6.1 uses. The `knowledge` module still imports nothing from `sources`.
4. Returns the image's hash and type; `src/server/share-read.ts` opens the blob and streams it.

Every failure, from a malformed token to a path the revision does not reference, is the same `ShareLinkNotFoundError` and the same 404. No response says whether a file exists.

- Headers are those of §6.1 plus the ones the share spec §6.4 sets for the page, including `Cache-Control: private, no-store`. A shared image is therefore refetched rather than revalidated, which is what makes a revocation immediate.
- An image request records **no view**. A view is a page load; counting images would multiply it by the number of pictures.
- The token is in the image URL, as it is in the page URL. The page's existing referrer policy keeps both from leaving the origin.
- The page still passes the renderer no link resolutions. The image base arrives through a context provider around the unchanged `<MarkdownRenderer markdown={shared.markdown} />`, so the existing guard on that line keeps its meaning.

Not granted: other images in the folder, images only an older revision referenced, any non-image file, and anything §6.1 would deny for lack of a stored blob.

## 7. Cleanup, backup, recovery

- **Unreferenced blobs.** A blob is garbage when no stored `knowledge_assets` row and no `BUILDING` or `READY` snapshot entry has its hash, **and** its file is older than 48 hours. The age test covers the gap between upload and Apply; staging lives at most 24 hours. The sweep runs where `cleanup-folder-imports` already runs, and as `scripts/storage/blobs.ts gc`.
- **Missing blobs.** `scripts/storage/blobs.ts verify` lists stored assets whose file is absent. The endpoint answers 404 for them and the reader sees the placeholder. The repair is a re-sync: `verify --repair` clears the row's stored flag, and the next sync uploads the image again.
- **Backup.** Database first, then the directory. Files are only ever added, so a directory copied later than the database holds everything the database refers to. The README gains this paragraph.
- **Disk full.** `put` fails, the upload returns 507, and the import stops before Finalize with nothing applied. Give images their own volume so a full image disk cannot stop MariaDB.

## 8. Compatibility

- No `KM_BLOB_DIR`: no behaviour changes anywhere.
- Enabling it changes nothing until a source is next synced. That Preview lists the source's images as updated assets even when no Markdown changed.
- Disabling it later: the endpoint answers 404 and readers see placeholders. No file is deleted. A source synced while it is off loses its stored flags, so its images upload again after it is turned back on.
- Phase 2 spec §5.4 and §12 are amended in place: assets carry bytes when they are images and a store is configured.

### 8.1 Share-link contract amendment

Changed together with the code, in one commit, never ahead of it:

- **`CLAUDE.md`**, the bearer-grant paragraph. Proposed wording: "It is accepted by exactly two routes, the page `/s/:token` and the images that page draws, `/s/:token/asset` (through `DocumentShareService.readShared` and `readSharedImage`), and grants whoever holds it the current revision of one document and the images that revision references — never search, tree, history, MCP, any other file, or any write."
- **Share-link spec** §6.1 ("sole entry point") and §6.2 ("no expansion to other read surfaces"): amended in place to name the second route and point here.
- **`tests/unit/share-link-single-exception.test.ts`**: the caller-less list becomes `readShared` and `readSharedImage`; the "only the `/s/:token` projection reaches the caller-less entry" check covers both names and still allows only `src/server/share-read.ts`. A new case: nothing outside `share-read.ts` and the §6.1 projection opens a blob.

## 9. Tests

| Requirement | Layer |
| --- | --- |
| `put` rejects a wrong hash or size and leaves nothing under a real key; a repeated `put` is a no-op; a crash mid-write leaves only a temp file | unit, filesystem adapter in a temp dir |
| Path resolution: `./a.png`, `../a.png`, `/a.png`, percent-encoding, and every form that escapes the root | unit |
| Extension table decides type and Content-Type; the MIME hint is ignored | unit |
| Server refuses to start when `KM_BLOB_DIR` is set and unusable; feature is off when unset | unit |
| Upload: only the creator, only `BUILDING`, bytes must match; replay is harmless | integration |
| A hash present in the store from another workspace does not satisfy Finalize | integration |
| A pre-existing reference-only image is reconciled as an updated asset and stored by that sync | integration |
| Apply writes the stored flag with the asset row; other assets and empty images stay reference-only | integration |
| Endpoint: reader gets bytes and headers; non-member, another user's Personal workspace and no session get the document's own denial; an image in another source is 404 | integration |
| `gc` keeps referenced, staged and young blobs and removes the rest | integration |
| Shared image: a valid link serves an image its current revision references, with no view recorded | integration |
| Shared image: an image in the same folder that the revision does not reference, an image only an older revision referenced, a non-image, and a path outside the root are each the same 404 | integration |
| Shared image: an expired link, a revoked link, an archived document or source, and a malformed token are each the same 404, and none differs from the row above | integration |
| Image-source extraction agrees with what the renderer draws, over one shared fixture | unit |
| `share-link-single-exception.test.ts` is amended as §8.1 says, and its link-resolution case passes unchanged | unit |
| Import a folder with images → Preview shows them → Apply → the document shows the image; share it → the shared page shows the image signed out; revoke → the image stops loading | e2e |

## 10. Considered and left out

- **Obsidian embeds, `![[image.png]]`.** The link extractor deliberately treats an embed as "not a link" and the renderer does not draw one. Supporting it touches the Markdown pipeline and the wikilink round-trip rule. Standard `![alt](path)` covers generated wikis and vaults with wikilinks turned off; default Obsidian vaults will still show no images.
- **Hub-managed notes.** There is no image upload in the editor.
- **Non-image attachments** (PDF, archives). Different rendering and a different risk profile.
- **S3-compatible adapter.** The port is shaped for it. Build it when a deployment has no persistent disk or more than one application server.
- **Source health for images.** Listing missing or unsupported images per source needs image references in the link index. The reader's placeholder is the only signal for now.
- **Database BLOB.** Up to 512 MiB of binary per import in the database makes every backup, restore and test environment carry it.

## 11. Decisions

Confirmed 2026-10-08:

1. **Shared pages show images**, in this delivery (§6.4, §8.1).
2. **Obsidian `![[…]]` embeds are not supported** for now (§10). Default Obsidian vaults will show no images until they are.
3. **Images carry no version.** History shows today's image (§6.3).
4. **SVG is accepted**, served with a sandboxing CSP (§5.1, §6.1).

## 12. Changes made while planning

Recorded 2026-10-08, after reading the import code for the implementation plan (`docs/superpowers/plans/2026-10-08-folder-sync-images.md`). The behaviour in §1 is unchanged; these are mechanics.

| First draft | Now | Why |
| --- | --- | --- |
| Migration 017 with `stored_at` and `asset_uploaded_at` | No migration; `metadata.stored` and the entry's existing `upload_status` / `source_file_hash` (§4) | The columns exist, and the reconciler already treats a metadata difference as a change |
| A *To store* label in Preview | Listed under updated assets (§5.3) | Falls out of the above with no reconciler or UI change |
| `PUT …/assets/:entryId` | `PUT …/asset?uploadKey=` (§5.2) | The browser knows upload keys, not entry IDs |
| `ASSET_UPLOAD_INCOMPLETE` | The existing `UPLOAD_INCOMPLETE` (§5.3) | One condition, one code |
| Apply re-checks every blob | It does not (§5.3) | Cleanup already cannot remove a blob a live snapshot refers to |
| No base in context renders a placeholder | The `src` is written as today (§6.2) | Changes nothing for existing renderers |
| A 0-byte image | Recorded, never stored | An upload needs a body |
