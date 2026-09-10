# Phase 0 foundation verification

Date: 2026-09-10 (Asia/Taipei)

## Environment

- Node.js `v24.19.0` from the pinned workspace runtime.
- npm `11.9.0` with the committed `package-lock.json`.
- MariaDB `10.11.19-MariaDB` in the dedicated `hcm-km-phase0` Compose project, exposed on `127.0.0.1:3307`.
- Compose image digest: `mariadb@sha256:07c0aaff7396b74cb7975cba78257178d188e30f531a5db2b617c48beef13c41`.
- Chromium supplied by the installed Playwright browser cache.
- Production dependencies resolved with `package-lock.json` and `npm ci`.

## Executed checks

| Command | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` | PASS | strict TypeScript check completed with no diagnostics |
| `npm run lint` | PASS | ESLint completed with zero errors |
| `npm run test:unit` | PASS | 4 files, 12 tests |
| `npm run test:integration` | PASS | isolated MariaDB 10.11 database; 3 files, 21 tests |
| `npm run build` | PASS | Next.js production build completed |
| `npm run test:e2e` | PASS | isolated database and production server; Chromium smoke 1/1 |

The integration suites use two real database connections for source-version races, test commit and rollback outcomes, verify migration ledger diagnostics including unknown-manifest rejection, required lifecycle actor columns, Workspace membership and direct UUID access boundaries, same-document current-revision constraints, ownership guards, lifecycle filtering, concurrent tree moves, revision allocation, mapping reappearance, atomic rollback, and metadata-only assets. The browser smoke creates a document in the seeded Workspace, reloads its stable URL, and reaches it again through the source tree while forged identity fields are ignored.

During final verification, the first browser assertion tried to assert visibility on an HTML `<option>`, which Playwright correctly reports as hidden. The check was changed to assert the selected Workspace value/text while retaining the same user-visible flow; the rerun passed.

## Delivered boundary

The implementation contains the ten canonical domain tables plus the migration ledger, native UUID columns, required lifecycle actor provenance, same-connection MariaDB transactions, Local Identity, Workspace/Membership policy, Knowledge application operations, SourceEntry version safety, and the minimal Workspace → Source → Tree Web adapter. Source-managed writes are available only through the internal source operation boundary; general Hub mutations reject them.

Folder scanning and matching, Preview／Confirm／Apply product flow, enterprise SSO and complete production governance, publishing, search, MCP, embeddings, agent memory, binary storage, and hard delete are intentionally outside Phase 0.
