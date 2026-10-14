# Hub image upload: implementation plan

**Spec:** `docs/superpowers/specs/2026-10-13-hub-image-upload-design.md`. Stacked on PR #151 (`feat/folder-sync-images`).

Each task is test-first and ends green on `make verify`; tasks 2, 3 and 6 also on their integration or e2e suites.

| # | Task | Files | Tests |
| --- | --- | --- | --- |
| 1 | Detect an image's type from its leading bytes | `src/shared/images/detect-image-type.ts` | `tests/unit/detect-image-type.test.ts` |
| 2 | Upload: `UploadSourceImageService` (authorize as a document write, hash, `BlobStore.put`, upsert the asset `images/<sha>.<ext>`), `POST /api/sources/:sourceId/images`, `POST /api/workspaces/:workspaceId/images` | `src/modules/sources/application/upload-source-image.ts`, the two routes, `src/server/composition.ts` | `tests/integration/hub-images.test.ts` |
| 3 | Reading: `findStoredImage` resolves a document with no source entry from its source root; `findStoredSourceImage` and `DocumentImageService.findInSource`; `GET /api/sources/:sourceId/asset`; header rule in `next.config.ts` | `source-policy` port and adapter, `document-image-service.ts`, the route | `tests/integration/hub-images.test.ts` (reader, history, shared page, source route) |
| 4 | Editor core: `imageUrl` display mapping on the image node; `onImageFiles` for paste and drop; `insertImage` on the handle | `src/components/knowledge/editor/editor-core.ts` | `tests/unit/editor-images.test.ts` (jsdom, rendered editor: round trip, display URL, insert, paste without files untouched) |
| 5 | Composer: upload flow, status line, save waits, source-view paste and drop; pages pass the source and whether images are stored | `rendered-editor.tsx`, `document-composer.tsx`, `document-editor.tsx`, `new-document-form.tsx`, the edit and new pages | `tests/unit/composer-images.test.ts` for the pure parts (`insertAtCaret`, alt text, failure messages) |
| 6 | End to end and documents | `tests/e2e/zz-hub-images.spec.ts`, README (en, zh-TW), import guide and user guide lines, spec status | paste → save → reader → shared page; store down |

Order matters only where shown: 3 needs 2's assets, 5 needs 2–4, 6 needs all.
