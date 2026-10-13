# Images in Hub pages: paste, drop, and keep

| Item | Content |
| --- | --- |
| Date | 2026-10-13 |
| Type | Design specification |
| Why | A page written in the Hub cannot hold an image. The editor accepts no file, and `![alt](path)` there points at nothing. Folder Sync images (`2026-10-08-folder-sync-images-design.md`) solved this only for content that arrives from a folder. Pasting a screenshot into a note is the most common way anyone adds a picture, and it does nothing. |
| Related | `2026-10-08-folder-sync-images-design.md` (store, serving, shared pages), `2026-09-28-document-composer-design.md` (editor, image policy §198), `2026-09-29-personal-daily-driver-design.md` §1.1 (the editor writes back what it read), `CLAUDE.md` (source ownership; share-link grant) |
| Status | Implemented (plan: `docs/superpowers/plans/2026-10-13-hub-image-upload.md`). Upload: `src/modules/sources/application/upload-source-image.ts`, `src/server/source-images.ts`, `POST /api/sources/:sourceId/images`, `POST /api/workspaces/:workspaceId/images`. Reading: `findStoredImage` / `findStoredSourceImage` in the source-policy port, `DocumentImageService.findInSource`, `GET /api/sources/:sourceId/asset`. Editor: `editor-core.ts` (`imageUrl`, `onImageFiles`, `insertImage`), `rendered-editor.tsx`, `document-composer.tsx`, `src/lib/composer-images.ts`. Tests: unit `detect-image-type`, `editor-images`, `composer-images`; integration `hub-images`; e2e `zz-hub-images.spec.ts`. The five decisions in §10 were confirmed as written. Builds on PR #151. |

## 1. What it delivers

1. In the editor of a Hub-managed page, **pasting or dropping an image** uploads it and puts it in the page.
2. The image shows in the editor, in the reader, in every past revision that used it, and on a shared page.
3. Synced (source-managed) pages are unchanged: they stay read-only and their images still come from the folder.
4. With no image store configured, or with the store down, the editor behaves as today and says why the image was not added.

## 2. Bedrock constraints

- **A new note has no document yet.** The composer keeps an unsaved note as the draft `draft:new`. An image pasted there needs an owner that exists before the document does.
- **A Hub page has no source path.** `findStoredImage` resolves an image against the document's entry in `source_entries`; Hub documents have none.
- **The editor must write back what it read.** Markdown is the stored form. Anything the editor shows differently from what it stores must not leak into the Markdown, or a page loses content on its next save.
- **Revisions are immutable and must stay readable.** Unlike a synced folder, nothing outside the Hub holds an older copy of a Hub page's image.
- **The image policy does not move.** Only same-origin image URLs load (`markdown-image-policy.ts`, `img-src 'self'`), in the reader and in the editor.
- **The store wants the hash first.** `BlobStore.put` takes the SHA-256 before the bytes.

## 3. The design in one paragraph

An uploaded image belongs to the **source**, not to a document, and is named by its content: it is stored as the asset `images/<sha256>.<ext>` of the page's Hub-managed source, and the Markdown refers to it as `![alt](/images/<sha256>.<ext>)`. A source exists before any document in it, so drafts work. The path never changes meaning, so every revision keeps showing the image it was written with. And because it is an ordinary stored asset addressed by an ordinary path, the reader endpoint, the shared-page rule ("only images the current revision references") and the blob store from Folder Sync images all apply as they are, once a Hub document can be resolved without a source entry.

## 4. Upload

```text
POST /api/sources/:sourceId/images           body: the image bytes   → 201 { "src": "/images/<sha256>.<ext>", "sourceId": "…" }
POST /api/workspaces/:workspaceId/images     the same, for a note that is not saved yet
```

A new note's source is chosen by the server when it is first saved: the workspace's default Hub source, created on first use. The second route does the same on first upload, with the authorization the first save would need, and returns the source so the editor can show the image. The new-note page passes that source's ID when it already exists (a lookup, never a creation), so a draft reopened later still shows its images.

- **Who.** The caller must be allowed to write a document in that source: source `ACTIVE` and `HUB_MANAGED`, workspace writable, the same checks `createDocument` makes. A source-managed source answers as it does for an edit (`SourceReadOnlyError`).
- **What.** `png`, `jpeg`, `gif`, `webp`, `avif`, decided by the file's leading bytes, and `svg`, decided by parsing it: well-formed XML whose root is `svg` (the `is-svg` package). The browser's `Content-Type` and any file name are ignored. An SVG is stored as given, not cleaned: what keeps a scripted one inert is how it is served and drawn, the same as an SVG from a synced folder.
- **How much.** At most 10 MiB, checked against `Content-Length` before reading and against the bytes read. Larger is 413. An SVG is parsed only up to 2 MiB: parsing is synchronous, about 35 ms per MiB, and nothing else is answered meanwhile. A larger one is refused as "not an image".
- **How.** The body is read into memory (bounded by the limit), hashed, its type detected, and passed to `BlobStore.put` with its own hash. Then one row is upserted in `knowledge_assets`: `source_path = images/<sha256>.<ext>`, `content_hash`, `metadata = { size, stored: true }`. Uploading the same image again changes nothing and returns the same `src`.
- **When there is no store.** 404 with `IMAGE_STORAGE_NOT_CONFIGURED`; the editor is told at render time and does not intercept paste or drop at all.
- **When the store is down.** The existing 503 `IMAGE_STORAGE_UNAVAILABLE`. The draft is untouched.

Nothing is written to a document by an upload. The image enters a page only when the author saves Markdown that refers to it.

## 5. Reading

- **`findStoredImage` learns Hub documents.** With no source entry, the document is treated as sitting at the root of its own source, so `/images/<sha>.<ext>` resolves to the asset `images/<sha>.<ext>`. Everything after that is unchanged: the reader's `GET /api/documents/:id/asset`, its authorization, the response headers, and `readSharedImage` with its "the current revision draws it" test.
- **The editor needs one more route**, because a draft has no document to ask through:

  ```text
  GET /api/sources/:sourceId/asset?src=<as written>
  ```

  Authorized by the right to read the source's workspace, resolved from the source root, answered by the same `imageResponse`. It serves stored images only, like the document route.

- **History is right.** An old revision's Markdown names the hash of the image it was written with, and that asset is never replaced. This is better than synced folders, where history shows the folder's current file.

## 6. The editor

Two additions to the rendered editor, and one to the Markdown source view.

- **Showing.** The image node gains a display mapping: where it writes `<img src>`, a relative source is sent to the source route above. The node's `src` attribute, which is what gets serialized, is untouched, and the real source keeps travelling in `data-kh-src` as it does now for copy and paste. So `![a](/images/x.png)` is read, shown and written back as `![a](/images/x.png)`.
- **Adding.** A paste or drop that carries image files is taken by the editor instead of ProseMirror's default. Each file is uploaded; on success an image node with the returned `src` is inserted at the drop point or the selection. Its `alt` is the file's name without extension, or "Pasted image" for a clipboard image with no name. A paste or drop with no image files is not touched.
- **Source view.** The same paste or drop into the Markdown textarea inserts `![alt](src)` at the caret.
- **Feedback.** While an upload runs, a status line under the editor (`aria-live="polite"`) says "Uploading image…"; saving waits for it. A failure says why (too large, not an image, storage unavailable, no permission) and inserts nothing.
- **Not in the first delivery.** A placeholder in the text while uploading, resizing, captions, an image button in the toolbar, and editing `alt` in the rendered view (it can be edited in the source view).

## 7. What does not change

- **Share links.** The grant is still the document's current revision and the images it references. No new caller-less path; `tests/unit/share-link-single-exception.test.ts` should pass unedited.
- **Synced pages.** No upload: they are not editable in the Hub.
- **Module boundaries.** The upload is a Sources operation (assets and the blob store live there). Knowledge reaches it through nothing new: the editor calls the route, and the Markdown it saves is plain Markdown.
- **Export.** The ZIP still carries no attachment bytes; a page's `/images/…` links will not resolve offline. Stated in the export's existing limitation.

## 8. Limits accepted for now

- **Uploaded images are never deleted.** An image pasted and then removed, or uploaded into a draft that is discarded, stays in the store. Finding the unreferenced ones means searching every revision and draft for the path; nothing does that yet. `blobs gc` leaves them alone because their asset rows mark them stored. Growth is bounded only by the 10 MiB per-image limit.
- **No per-user or per-workspace quota.** A member who can write can fill the store.
- **A page's images live in its source.** A page cannot be moved to another source (already an error), so this does not bite today.

## 9. Tests

| Requirement | Layer |
| --- | --- |
| Type detection from leading bytes: each accepted type; SVG, PDF, HTML, empty and truncated input refused; `Content-Type` ignored | unit |
| The rendered editor reads `![a](/images/x.png)`, shows it through the source route, and writes it back unchanged (the round-trip rule; runs the rendered editor, not the source view) | unit, with `tests/fixtures/link-markdown.ts`-style cases |
| A pasted image and a dropped image each insert exactly `![alt](/images/<sha>.<ext>)`; a paste without files is left to the editor | unit (rendered editor) |
| Upload: a writer gets a `src`; the same bytes twice give the same `src` and one asset row; a reader without write, a source-managed source, an archived source, another user's workspace are refused as a document write is | integration |
| Upload: over the limit is 413 before the body is read; not-an-image is 400; no store is 404; store down is 503 | integration |
| A Hub document's image resolves through `/api/documents/:id/asset`; a revision saved before the image was replaced in the text still shows the old one | integration |
| Source route: member reads, non-member is refused as for the source, unknown path is 404 | integration |
| Shared page: an uploaded image the current revision references is served; one uploaded to the same source but not referenced is the same 404 | integration |
| Paste a PNG into a new note → it appears → save → reader shows it → share → the signed-out page shows it; with the store down, the paste reports the outage and the note still saves | e2e |

## 10. Decisions (confirmed 2026-10-13)

1. ~~No SVG upload.~~ **Reversed 2026-10-13: SVG is accepted**, up to 2 MiB. The first draft refused it because its type cannot be told from leading bytes and it can carry script. The second reason did not hold: an uploaded SVG is served and drawn exactly as a synced one already is (`<img>`, `nosniff`, a sandboxing policy), and the e2e test opens one with a script and sees it not run. The first is answered by parsing. Entities are not expanded by the parser, so a "billion laughs" document costs nothing to check.
2. **Uploaded images are never deleted in this delivery** (§8).
3. **10 MiB per image**, a constant, not a setting.
4. **Both views**: the rendered editor and the Markdown source view accept paste and drop.
5. **Stacked on PR #151.** This cannot merge before it.
