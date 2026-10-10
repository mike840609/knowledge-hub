import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { RandomShareTokenIssuer } from "@/infrastructure/security/random-share-token-issuer";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { DocumentShareService } from "@/modules/knowledge/application/document-share-service";
import { DocumentReviewService } from "@/modules/knowledge/application/document-review-service";
import { ApplyFolderImportService } from "@/modules/sources/application/apply-folder-import";
import { CreateFolderImportService } from "@/modules/sources/application/create-folder-import";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { UploadFolderImportEntriesService } from "@/modules/sources/application/upload-folder-import-entries";
import { DEFAULT_IMPORT_LIMITS } from "@/modules/sources/domain/import-limits";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";
import type { ReviewAnchor } from "@/modules/knowledge/domain/document-review";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

async function fixture() {
  const uow = new MariaDbUnitOfWork(pool);
  const id = uuidv7();
  const owner = { id, emp_id: `REVIEW-SYNC-${id}`, name: "Sync reviewer", org_code: "TEST" };
  await uow.run(r => r.users.upsertIdentity(owner));
  const caller = callerFromIdentity(owner);
  const { workspace } = await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(id);
  const create = new CreateFolderImportService(uow, { limits: DEFAULT_IMPORT_LIMITS });
  const upload = new UploadFolderImportEntriesService(uow, { limits: DEFAULT_IMPORT_LIMITS });
  const finalize = new FinalizeFolderImportService(uow, { limits: DEFAULT_IMPORT_LIMITS });
  const apply = new ApplyFolderImportService(uow, {});
  async function sync(markdown: string, sourceId?: string) {
    const bytes = new TextEncoder().encode(markdown);
    const manifest = [{ uploadKey: `review-${uuidv7()}`, relativePath: "review.md", kind: "MARKDOWN" as const, size: bytes.length }];
    const start = sourceId
      ? await create.createResync(caller, { sourceId, rootName: "review", manifest })
      : await create.createInitial(caller, { workspaceId: workspace.id, sourceName: "Review folder", rootName: "review", manifest });
    await upload.upload(caller, { snapshotId: start.snapshotId, entries: [{ uploadKey: manifest[0].uploadKey, bytes }] });
    await finalize.finalize(caller, start.snapshotId);
    const result = await apply.apply(caller, start.snapshotId);
    if (result.kind !== "APPLIED") throw new Error("Expected successful Folder Sync");
    return result.sourceId;
  }
  const sourceId = await sync("# Review\n\nStable selected passage.\n");
  const rows = await pool.query<{ id: string; current_revision_id: string }[]>("SELECT id, current_revision_id FROM knowledge_documents WHERE source_id = ?", [sourceId]);
  const documentId = String(rows[0].id);
  const revisionId = String(rows[0].current_revision_id);
  const shares = new DocumentShareService(uow, new RandomShareTokenIssuer());
  const link = await shares.create(caller, { documentId });
  const token = link.path.slice(3);
  const reviews = new DocumentReviewService(uow, undefined, () => true);
  const anchor: ReviewAnchor = { schemaVersion: 1, blockPath: [1], blockKind: "paragraph", startUtf16: 0, endUtf16: 24, exact: "Stable selected passage.", prefix: "", suffix: "" };
  return { caller, reviews, shares, link, token, sourceId, documentId, revisionId, anchor, sync };
}

describe("review remains separate from SOURCE_MANAGED Folder Sync", () => {
  it("preserves threads across sync, replays the original write, and strips removed historical quotes", async () => {
    const f = await fixture();
    const input = { token: f.token, expectedRevisionId: f.revisionId, anchor: f.anchor, body: "Please clarify this choice", idempotencyKey: crypto.randomUUID() };
    const thread = await f.reviews.createForLink(f.caller, input);
    await f.sync("# Review\n\nNew introduction.\n\nStable selected passage.\n", f.sourceId);
    const moved = (await f.reviews.queryForLink(f.caller, f.token)).threads;
    expect(moved[0].id).toBe(thread.id);
    expect(moved[0].currentAnchor).toMatchObject({ match: "MOVED", anchor: { blockPath: [2] } });
    expect((await f.reviews.createForLink(f.caller, input)).id).toBe(thread.id);
    await expect(f.reviews.createForLink(f.caller, { ...input, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "STALE_DOCUMENT_REVISION" });
    await f.sync("# Review\n\nReplacement text only.\n", f.sourceId);
    const outdated = (await f.reviews.queryForLink(f.caller, f.token)).threads;
    expect(outdated[0].currentAnchor).toEqual({ match: "OUTDATED" });
    expect(JSON.stringify(outdated)).not.toContain("Stable selected passage.");
    expect((await f.reviews.queryForOwner(f.caller, f.documentId)).threads[0].originalAnchor.exact).toBe(input.anchor.exact);
    const markdown = await f.shares.readShared(f.token);
    expect(markdown.markdown).toBe("# Review\n\nReplacement text only.\n");
    expect(markdown.markdown).not.toContain(input.body);
  });

  it("serializes revoke against writes and refuses idempotent replay after revocation", async () => {
    const f = await fixture();
    const input = { token: f.token, expectedRevisionId: f.revisionId, anchor: f.anchor, body: "Concurrent write", idempotencyKey: crypto.randomUUID() };
    const results = await Promise.allSettled([
      f.reviews.createForLink(f.caller, input),
      f.shares.revoke(f.caller, f.link.id),
    ]);
    expect(results[1].status).toBe("fulfilled");
    if (results[0].status === "rejected") expect(results[0].reason).toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    await expect(f.reviews.createForLink(f.caller, input)).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    await expect(f.reviews.queryForLink(f.caller, f.token)).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    const rows = await pool.query<{ n: number }[]>("SELECT COUNT(*) AS n FROM document_review_threads WHERE document_id = ?", [f.documentId]);
    expect(Number(rows[0].n)).toBe(results[0].status === "fulfilled" ? 1 : 0);
    expect((await f.reviews.queryForOwner(f.caller, f.documentId)).threads.length).toBe(Number(rows[0].n));
  });
});
