# MinIO resilience verification — 2026-10-13 (Asia/Taipei)

Base: PR #151 head `70d5dd2779a4fd0134e4e75a8c00ceb332f1658b`.

Scope: conditional local MinIO startup, absolute S3 deadlines and graceful startup during temporary image-storage outages. No changes to document/image authorization or storage fallback semantics.

## Regression evidence

Before implementation, focused tests reproduced startup failures for HTTP 408/429/500/502/503/504, missing deadline validation, requests and response bodies exceeding their deadline, and generic HTTP 500 for image-storage outages (13 failing tests). The local-storage launcher tests also failed because no conditional launcher existed (3 tests).

After implementation, tests cover connection stalls, unfinished upload bodies and input cancellation, missing upload responses, stalled and trickled response bodies, streamed image reads, early server responses, HTTP 503 mapping without internal details, and recovery using the same store. Startup tests retain rejection of HTTP 400/401/403/404. Import tests verify recovery retries and abandonment without finalization after four failed image attempts. Launcher tests exercise .env parsing, environment overrides (including empty values), local endpoints, disabled storage, directory storage and remote S3.

## Results

- `npm run test:unit`: 175 files, 2,044 tests passed on the final implementation.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run test:integration` with `KM_TEST_S3_*` selecting the local MinIO: 76 files, 708 tests passed. The harness provisioned and removed an isolated database.
- `npm run test:e2e -- tests/e2e/zz-folder-images.spec.ts` with `KM_TEST_S3_*` selecting local MinIO and port 3191: 2 passed. This includes real form upload, image decoding in the reader and anonymous share page, SVG policy headers and script blocking, rejection of an unreferenced image, and share revocation. The harness built the final implementation and cleaned up its isolated database.
- `make storage-auto` with directory storage and remote S3 settings: both skipped local MinIO.
- `git diff --check`: passed.

Limits: company MinIO was not available for validation. Full E2E was not rerun; the affected image suite was run against MinIO. PR #151 already had conflicts with current main; these checks validate the PR branch plus the resilience changes, without merging main. No deployment or PR merge was performed.
