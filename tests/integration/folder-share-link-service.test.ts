import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { RandomShareTokenIssuer } from "@/infrastructure/security/random-share-token-issuer";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { DocumentShareService } from "@/modules/knowledge/application/document-share-service";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { ApplyFolderImportService } from "@/modules/sources/application/apply-folder-import";
import { CreateFolderImportService } from "@/modules/sources/application/create-folder-import";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { UploadFolderImportEntriesService } from "@/modules/sources/application/upload-folder-import-entries";
import { DEFAULT_IMPORT_LIMITS } from "@/modules/sources/domain/import-limits";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { createDocumentFixture, createSourceFixture, fixtureCaller } from "../fixtures/knowledge";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

function newIdentity(name: string): UserIdentity {
  const id = uuidv7();
  return { id, emp_id: `FOLDER-SHARE-${id}`, name, org_code: "SHARE" };
}

function service(clock?: () => Date) {
  return new DocumentShareService(new MariaDbUnitOfWork(pool), new RandomShareTokenIssuer(), clock);
}

/** A My Space owned by a fresh user, with one HUB_MANAGED folder holding one document. */
async function mySpaceFolder() {
  const owner = newIdentity("Folder Owner");
  const unitOfWork = new MariaDbUnitOfWork(pool);
  await unitOfWork.run((repositories) => repositories.users.upsertIdentity(owner));
  const { workspace } = await new PersonalWorkspaceService(unitOfWork).ensurePersonalWorkspace(owner.id);
  const caller = callerFromIdentity(owner);
  const sourceId = await ensureDefaultHubSource(unitOfWork, caller, workspace.id);
  const hub = new HubKnowledgeCommandServiceImpl(unitOfWork);
  const { treeNodeId: folderNodeId } = await hub.createFolder(caller, { sourceId, parentId: null, name: "Shared Folder" });
  const { documentId } = await hub.createDocument(caller, { sourceId, parentId: folderNodeId, title: "Inside", markdown: "body", metadata: {} });
  return { owner, caller, workspaceId: workspace.id, sourceId, folderNodeId, documentId };
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const rows = await pool.query<{ n: unknown }[]>(sql, params);
  return Number(rows[0].n);
}

const linkRows = (folderNodeId: string) => count("SELECT COUNT(*) AS n FROM document_share_links WHERE folder_node_id = ?", [folderNodeId]);
const auditRows = (workspaceId: string, eventType: string) =>
  count("SELECT COUNT(*) AS n FROM workspace_audit_events WHERE workspace_id = ? AND event_type = ?", [workspaceId, eventType]);
const tokenOf = (path: string) => path.slice("/s/".length);

describe("DocumentShareService.createForFolder (folder share links §8)", () => {
  it("issues a UUIDv4 link on an ACTIVE My Space folder that expires in 30 days by default", async () => {
    const { caller, folderNodeId } = await mySpaceFolder();
    const now = new Date("2026-10-29T08:00:00.000Z");
    const link = await service(() => now).createForFolder(caller, { folderNodeId });
    expect(link.path).toMatch(/^\/s\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(link.expiresAt.toISOString()).toBe("2026-11-28T08:00:00.000Z");
    expect(link.active).toBe(true);
    expect(await linkRows(folderNodeId)).toBe(1);
  });

  it("stores the link against the folder node, not a document", async () => {
    const { caller, folderNodeId } = await mySpaceFolder();
    await service().createForFolder(caller, { folderNodeId, label: "team", expiresInDays: 7 });
    const rows = await pool.query<{ document_id: unknown; label: unknown }[]>("SELECT document_id, label FROM document_share_links WHERE folder_node_id = ?", [folderNodeId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].document_id).toBeNull();
    expect(rows[0].label).toBe("team");
  });

  it("refuses a DOCUMENT node with a ValidationError and writes nothing", async () => {
    const { caller, sourceId, documentId, workspaceId } = await mySpaceFolder();
    const rows = await pool.query<{ id: unknown }[]>("SELECT id FROM knowledge_tree_nodes WHERE source_id = ? AND document_id = ?", [sourceId, documentId]);
    const documentNodeId = String(rows[0].id);
    await expect(service().createForFolder(caller, { folderNodeId: documentNodeId })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await linkRows(documentNodeId)).toBe(0);
    expect(await auditRows(workspaceId, "DOCUMENT_SHARE_LINK_CREATED")).toBe(0);
  });

  it("refuses a node id that does not exist", async () => {
    const { caller } = await mySpaceFolder();
    await expect(service().createForFolder(caller, { folderNodeId: uuidv7() })).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  });

  it("refuses a folder in a Team workspace", async () => {
    const { folderId } = await createSourceFixture(pool);
    await expect(service().createForFolder(fixtureCaller(), { folderNodeId: folderId })).rejects.toMatchObject({ code: "SHARE_LINK_NOT_PERSONAL" });
    expect(await linkRows(folderId)).toBe(0);
  });

  it("refuses someone else's My Space folder: a non-member is denied, a member of that workspace finds nothing", async () => {
    const { folderNodeId, workspaceId } = await mySpaceFolder();
    const stranger = newIdentity("Stranger");
    await expect(service().createForFolder(callerFromIdentity(stranger), { folderNodeId })).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });

    const member = newIdentity("Member");
    await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      await repositories.users.upsertIdentity(member);
      await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: member.id, role: "VIEWER", now: new Date() }));
    });
    await expect(service().createForFolder(callerFromIdentity(member), { folderNodeId })).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    expect(await linkRows(folderNodeId)).toBe(0);
  });

  it("refuses an ARCHIVED folder", async () => {
    const { caller, folderNodeId, owner } = await mySpaceFolder();
    await new MariaDbUnitOfWork(pool).run((repositories) => repositories.tree.updateStatus(folderNodeId, "ARCHIVED", owner.id));
    await expect(service().createForFolder(caller, { folderNodeId })).rejects.toMatchObject({ code: "DOCUMENT_ARCHIVED", message: "The shared folder is archived." });
    expect(await linkRows(folderNodeId)).toBe(0);
  });

  it("refuses a folder whose Source is ARCHIVED", async () => {
    const { caller, folderNodeId, sourceId, owner } = await mySpaceFolder();
    await new MariaDbUnitOfWork(pool).run((repositories) => repositories.sources.updateStatus(sourceId, "ARCHIVED", owner.id));
    await expect(service().createForFolder(caller, { folderNodeId })).rejects.toMatchObject({ code: "SOURCE_ARCHIVED" });
  });

  it("allows ten active links, refuses the eleventh; expired and revoked ones do not count", async () => {
    const { caller, folderNodeId } = await mySpaceFolder();
    const shares = service();
    const links = [];
    for (let index = 0; index < 10; index += 1) links.push(await shares.createForFolder(caller, { folderNodeId }));
    await expect(shares.createForFolder(caller, { folderNodeId })).rejects.toMatchObject({ code: "SHARE_LINK_LIMIT_REACHED", message: "A folder can have at most 10 active share links." });
    await shares.revoke(caller, links[0].id);
    await pool.query("UPDATE document_share_links SET created_at = NOW(6) - INTERVAL 2 DAY, expires_at = NOW(6) - INTERVAL 1 SECOND WHERE id = ?", [links[1].id]);
    await expect(shares.createForFolder(caller, { folderNodeId })).resolves.toMatchObject({ active: true });
    await expect(shares.createForFolder(caller, { folderNodeId })).resolves.toMatchObject({ active: true });
    await expect(shares.createForFolder(caller, { folderNodeId })).rejects.toMatchObject({ code: "SHARE_LINK_LIMIT_REACHED" });
  });

  it("counts per folder: another folder's links do not use up this folder's slots", async () => {
    const { caller, sourceId, folderNodeId } = await mySpaceFolder();
    const { treeNodeId: otherFolderId } = await new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool)).createFolder(caller, { sourceId, parentId: null, name: "Other" });
    const shares = service();
    for (let index = 0; index < 10; index += 1) await shares.createForFolder(caller, { folderNodeId: otherFolderId });
    await expect(shares.createForFolder(caller, { folderNodeId })).resolves.toMatchObject({ active: true });
  });

  it("rejects an expiry outside the allowed set", async () => {
    const { caller, folderNodeId } = await mySpaceFolder();
    await expect(service().createForFolder(caller, { folderNodeId, expiresInDays: 2 })).rejects.toMatchObject({ code: "INVALID_SHARE_LINK_EXPIRY" });
  });

  it("works on a SOURCE_MANAGED folder from a folder import", async () => {
    const { caller, workspaceId } = await mySpaceFolder();
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const bytes = new TextEncoder().encode("# Readme\n");
    const manifest = { uploadKey: `m-${uuidv7().slice(-8)}`, relativePath: "docs/readme.md", kind: "MARKDOWN" as const, size: bytes.byteLength };
    const start = await new CreateFolderImportService(unitOfWork, { limits: DEFAULT_IMPORT_LIMITS }).createInitial(caller, { workspaceId, sourceName: "Synced Wiki", rootName: "wiki", manifest: [manifest] });
    await new UploadFolderImportEntriesService(unitOfWork, { limits: DEFAULT_IMPORT_LIMITS }).upload(caller, { snapshotId: start.snapshotId, entries: [{ uploadKey: manifest.uploadKey, bytes }] });
    await new FinalizeFolderImportService(unitOfWork, { limits: DEFAULT_IMPORT_LIMITS }).finalize(caller, start.snapshotId);
    const applied = await new ApplyFolderImportService(unitOfWork, {}).apply(caller, start.snapshotId);
    if (applied.kind !== "APPLIED") throw new Error("expected the initial import to apply");
    const folders = await pool.query<{ id: unknown }[]>("SELECT id FROM knowledge_tree_nodes WHERE source_id = ? AND node_type = 'FOLDER'", [applied.sourceId]);
    expect(folders.length).toBeGreaterThan(0);
    const ownership = await pool.query<{ ownership: unknown }[]>("SELECT ownership FROM knowledge_sources WHERE id = ?", [applied.sourceId]);
    expect(ownership[0].ownership).toBe("SOURCE_MANAGED");
    await expect(service().createForFolder(caller, { folderNodeId: String(folders[0].id) })).resolves.toMatchObject({ active: true });
  });

  it("rolls the link back when its audit event cannot be written", async () => {
    const { caller, folderNodeId } = await mySpaceFolder();
    const inner = new MariaDbUnitOfWork(pool);
    const failing = {
      run: <T,>(work: Parameters<typeof inner.run<T>>[0]) => inner.run((repositories) => work({
        ...repositories,
        auditEvents: new Proxy(repositories.auditEvents, { get: (target, property, receiver) => (property === "append" ? async () => { throw new Error("audit unavailable"); } : Reflect.get(target, property, receiver)) }),
      })),
    };
    await expect(new DocumentShareService(failing, new RandomShareTokenIssuer()).createForFolder(caller, { folderNodeId })).rejects.toThrow();
    expect(await linkRows(folderNodeId)).toBe(0);
  });

  it("audits creation with the folder node id and no token", async () => {
    const { caller, folderNodeId, workspaceId } = await mySpaceFolder();
    const link = await service().createForFolder(caller, { folderNodeId, label: "team" });
    const rows = await pool.query<{ payload: unknown }[]>(
      "SELECT payload FROM workspace_audit_events WHERE workspace_id = ? AND event_type = 'DOCUMENT_SHARE_LINK_CREATED'", [workspaceId]);
    expect(rows).toHaveLength(1);
    const payload = typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload) : rows[0].payload;
    expect(payload).toMatchObject({ folderNodeId, label: "team" });
    expect(payload).not.toHaveProperty("documentId");
    expect(JSON.stringify(payload)).not.toContain(tokenOf(link.path));
  });
});

describe("DocumentShareService.listForFolder", () => {
  it("lists only that folder's links, newest first, with view totals", async () => {
    const { caller, sourceId, folderNodeId, documentId } = await mySpaceFolder();
    const shares = service();
    const first = await shares.createForFolder(caller, { folderNodeId, label: "first" });
    const second = await shares.createForFolder(caller, { folderNodeId, label: "second" });
    const { treeNodeId: otherFolderId } = await new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool)).createFolder(caller, { sourceId, parentId: null, name: "Other" });
    await shares.createForFolder(caller, { folderNodeId: otherFolderId, label: "elsewhere" });
    await shares.create(caller, { documentId, label: "document link" });
    await pool.query("INSERT INTO document_share_link_views (share_link_id, view_date, first_viewed_at, last_viewed_at, view_count) VALUES (?, CURDATE(), NOW(6), NOW(6), 4)", [first.id]);

    const listed = await shares.listForFolder(caller, folderNodeId);
    expect(listed.map((link) => link.label)).toEqual(["second", "first"]);
    expect(listed.find((link) => link.id === first.id)?.totalViews).toBe(4);
    expect(listed.find((link) => link.id === second.id)?.totalViews).toBe(0);
  });

  it("hides the list from anyone but the My Space owner", async () => {
    const { folderNodeId } = await mySpaceFolder();
    await expect(service().listForFolder(callerFromIdentity(newIdentity("Stranger")), folderNodeId)).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });
    await expect(service().listForFolder(fixtureCaller(), uuidv7())).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  });

  it("refuses a document node and a Team folder", async () => {
    const { caller, sourceId, documentId } = await mySpaceFolder();
    const rows = await pool.query<{ id: unknown }[]>("SELECT id FROM knowledge_tree_nodes WHERE source_id = ? AND document_id = ?", [sourceId, documentId]);
    await expect(service().listForFolder(caller, String(rows[0].id))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const team = await createSourceFixture(pool);
    await createDocumentFixture(pool, team.source.id, team.folderId);
    await expect(service().listForFolder(fixtureCaller(), team.folderId)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  });
});

describe("DocumentShareService.revoke on a folder link", () => {
  it("revokes for the owner, frees the link, and audits the folder node id once", async () => {
    const { caller, folderNodeId, workspaceId } = await mySpaceFolder();
    const shares = service();
    const link = await shares.createForFolder(caller, { folderNodeId });
    const now = new Date("2026-10-29T09:00:00.000Z");
    await service(() => now).revoke(caller, link.id);
    await shares.revoke(caller, link.id);
    const rows = await pool.query<{ revoked_at: unknown }[]>("SELECT revoked_at FROM document_share_links WHERE id = ?", [link.id]);
    expect(new Date(String(rows[0].revoked_at)).getTime()).not.toBeNaN();
    expect((await shares.listForFolder(caller, folderNodeId))[0]).toMatchObject({ id: link.id, active: false });
    const events = await pool.query<{ payload: unknown }[]>(
      "SELECT payload FROM workspace_audit_events WHERE workspace_id = ? AND event_type = 'DOCUMENT_SHARE_LINK_REVOKED'", [workspaceId]);
    expect(events).toHaveLength(1);
    const payload = typeof events[0].payload === "string" ? JSON.parse(events[0].payload) : events[0].payload;
    expect(payload).toMatchObject({ folderNodeId });
  });

  it("answers ShareLinkNotFoundError to a stranger and writes nothing", async () => {
    const { caller, folderNodeId } = await mySpaceFolder();
    const link = await service().createForFolder(caller, { folderNodeId });
    await expect(service().revoke(callerFromIdentity(newIdentity("Stranger")), link.id)).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    const rows = await pool.query<{ revoked_at: unknown }[]>("SELECT revoked_at FROM document_share_links WHERE id = ?", [link.id]);
    expect(rows[0].revoked_at).toBeNull();
  });

  it("still revokes after the folder has been archived", async () => {
    const { caller, folderNodeId, owner } = await mySpaceFolder();
    const link = await service().createForFolder(caller, { folderNodeId });
    await new MariaDbUnitOfWork(pool).run((repositories) => repositories.tree.updateStatus(folderNodeId, "ARCHIVED", owner.id));
    await expect(service().revoke(caller, link.id)).resolves.toBeUndefined();
    expect((await service().listForFolder(caller, folderNodeId))[0].active).toBe(false);
  });
});
