import { afterAll, beforeAll, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { RandomShareTokenIssuer } from "@/infrastructure/security/random-share-token-issuer";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { DocumentShareService } from "@/modules/knowledge/application/document-share-service";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";
let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => pool.end());
async function fixture() {
  const id = uuidv7(), uow = new MariaDbUnitOfWork(pool);
  const caller = callerFromIdentity({ id, emp_id: `SHARES-${id}`, name: "Owner", org_code: "SHARES" });
  await uow.run(r => r.users.upsertIdentity(caller.identity));
  const { workspace } = await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(id);
  const sourceId = await ensureDefaultHubSource(uow, caller, workspace.id);
  const { documentId } = await new HubKnowledgeCommandServiceImpl(uow).createDocument(caller, { sourceId, parentId: null, title: "Management guide", markdown: "saved body", metadata: {} });
  const now = new Date("2026-10-04T00:00:00Z");
  const shares = new DocumentShareService(uow, new RandomShareTokenIssuer(), () => now);
  return { caller, workspace, documentId, sourceId, shares, uow, now };
}
it("lists owner-only shares with literal search, effective status and view totals", async () => {
  const f = await fixture(), foreign = await fixture();
  const a = await f.shares.create(f.caller, { documentId: f.documentId, label: "Team %_!" });
  const b = await f.shares.create(f.caller, { documentId: f.documentId, label: "Expired" });
  const c = await f.shares.create(f.caller, { documentId: f.documentId, label: "Revoked" });
  await foreign.shares.create(foreign.caller, { documentId: foreign.documentId, label: "Team %_!" });
  await pool.query("UPDATE document_share_links SET created_at=?, expires_at=? WHERE id=?", [new Date("2026-10-02T00:00:00Z"), new Date("2026-10-03T00:00:00Z"), b.id]);
  await f.shares.revoke(f.caller, c.id);
  await f.uow.run(r => r.shareLinks.recordView(a.id, f.now));
  const result = await f.shares.listManagement(f.caller, f.workspace.id, { q: "%_!", status: "all" });
  expect(result.items.map(l => l.id)).toEqual([a.id]); expect(result.items[0].totalViews).toBe(1); expect(result.items[0].status).toBe("active");
  expect((await f.shares.listManagement(f.caller, f.workspace.id, { status: "expired" })).items.map(l => l.id)).toEqual([b.id]);
  expect((await f.shares.listManagement(f.caller, f.workspace.id, { status: "revoked" })).items.map(l => l.id)).toEqual([c.id]);
  await expect(f.shares.listManagement(foreign.caller, f.workspace.id, {})).rejects.toBeDefined();
  expect(await f.uow.run(r => r.shareLinks.listForWorkspace(f.workspace.id, foreign.caller.identity.id, { q: "", status: "all", page: 1 }, f.now, 51, 0))).toEqual([]);
  await pool.query("UPDATE knowledge_documents SET status='ARCHIVED',archived_by=?,archived_at=? WHERE id=?", [f.caller.identity.id, f.now, f.documentId]);
  expect((await f.shares.listManagement(f.caller, f.workspace.id, { status: "active" })).items).toEqual([]);
  expect((await f.shares.listManagement(f.caller, f.workspace.id, { status: "unavailable" })).items.map(l => l.id)).toEqual([a.id]);
  await f.shares.revoke(f.caller, a.id);
  await expect(f.shares.readShared(a.path.slice(3))).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
});
it("paginates filtered links with stable ordering and no repeated rows", async () => {
  const f = await fixture();
  for (let doc = 0; doc < 6; doc++) {
    const { documentId } = await new HubKnowledgeCommandServiceImpl(f.uow).createDocument(f.caller, { sourceId: f.sourceId, parentId: null, title: `Pagination guide ${doc}`, markdown: "body", metadata: {} });
    for (let i = 0; i < 9; i++) await f.shares.create(f.caller, { documentId, label: "page-test" });
  }
  const first = await f.shares.listManagement(f.caller, f.workspace.id, { q: "page-test", page: "1" });
  const second = await f.shares.listManagement(f.caller, f.workspace.id, { q: "page-test", page: "2" });
  expect(first.items).toHaveLength(50); expect(first.hasNext).toBe(true);
  expect(second.items).toHaveLength(4); expect(second.hasNext).toBe(false);
  expect(new Set([...first.items, ...second.items].map(l => l.id)).size).toBe(54);
});
