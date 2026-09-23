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
import type { KnowledgeRepositories, KnowledgeUnitOfWork } from "@/modules/knowledge/ports/unit-of-work";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { createDocumentFixture, createDocumentForAnySource, createSourceFixture, fixtureCaller } from "../fixtures/knowledge";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

function newIdentity(name: string): UserIdentity {
  const id = uuidv7();
  return { id, emp_id: `SHARE-${id}`, name, org_code: "SHARE" };
}

function service(unitOfWork: KnowledgeUnitOfWork = new MariaDbUnitOfWork(pool), clock?: () => Date) {
  return new DocumentShareService(unitOfWork, new RandomShareTokenIssuer(), clock);
}

/** A My Space owned by a fresh user, with one HUB_MANAGED document in it. */
async function mySpaceDocument() {
  const owner = newIdentity("Share Owner");
  const unitOfWork = new MariaDbUnitOfWork(pool);
  await unitOfWork.run((repositories) => repositories.users.upsertIdentity(owner));
  const { workspace } = await new PersonalWorkspaceService(unitOfWork).ensurePersonalWorkspace(owner.id);
  const caller = callerFromIdentity(owner);
  const sourceId = await ensureDefaultHubSource(unitOfWork, caller, workspace.id);
  const created = await new HubKnowledgeCommandServiceImpl(unitOfWork).createDocument(caller, {
    sourceId, parentId: null, title: "Shared Runbook", markdown: "first body", metadata: {},
  });
  return { owner, caller, workspaceId: workspace.id, sourceId, documentId: created.documentId, revisionId: created.revisionId };
}

/** A repository whose one method is replaced; keeps the prototype's other methods. */
function replacing<T extends object>(repository: T, method: keyof T, implementation: unknown): T {
  return new Proxy(repository, {
    get: (target, property, receiver) => (property === method ? implementation : Reflect.get(target, property, receiver)),
  });
}

/** Wraps the real unit of work, replacing some repositories. */
function overriding(override: (repositories: KnowledgeRepositories) => Partial<KnowledgeRepositories>): KnowledgeUnitOfWork & { runs: number } {
  const inner = new MariaDbUnitOfWork(pool);
  const wrapper = {
    runs: 0,
    run<T>(work: (repositories: KnowledgeRepositories) => Promise<T>): Promise<T> {
      wrapper.runs += 1;
      return inner.run((repositories) => work({ ...repositories, ...override(repositories) }));
    },
  };
  return wrapper;
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const rows = await pool.query<{ n: unknown }[]>(sql, params);
  return Number(rows[0].n);
}

const linkRows = (documentId: string) => count("SELECT COUNT(*) AS n FROM document_share_links WHERE document_id = ?", [documentId]);
const auditRows = (workspaceId: string, eventType: string) =>
  count("SELECT COUNT(*) AS n FROM workspace_audit_events WHERE workspace_id = ? AND event_type = ?", [workspaceId, eventType]);
const tokenOf = (path: string) => path.slice("/s/".length);

describe("DocumentShareService.create (share-link spec §5.1, §7.3, §8)", () => {
  it("issues a UUIDv4 link that expires in 30 days by default", async () => {
    const { caller, documentId } = await mySpaceDocument();
    const now = new Date("2026-09-23T08:00:00.000Z");
    const link = await service(undefined, () => now).create(caller, { documentId });
    expect(link.path).toMatch(/^\/s\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(link.expiresAt.toISOString()).toBe("2026-10-23T08:00:00.000Z");
    expect(link.active).toBe(true);
  });

  it("never issues a token computable from a neighbouring ID", async () => {
    const { caller, documentId } = await mySpaceDocument();
    const shares = service();
    const first = await shares.create(caller, { documentId });
    const second = await shares.create(caller, { documentId });
    const asNumber = (uuid: string) => BigInt(`0x${uuid.replaceAll("-", "")}`);
    const difference = asNumber(tokenOf(second.path)) - asNumber(tokenOf(first.path));
    expect(difference === 1n || difference === -1n).toBe(false);
    for (const link of [first, second]) {
      expect(tokenOf(link.path)).not.toBe(link.id);
      expect(tokenOf(link.path)).not.toBe(documentId);
    }
  });

  it("appends one audit event whose payload does not carry the token", async () => {
    const { caller, documentId, workspaceId } = await mySpaceDocument();
    const link = await service().create(caller, { documentId, label: "backend team", expiresInDays: 7 });
    expect(await auditRows(workspaceId, "DOCUMENT_SHARE_LINK_CREATED")).toBe(1);
    const rows = await pool.query<{ payload: unknown }[]>(
      "SELECT payload FROM workspace_audit_events WHERE workspace_id = ? AND event_type = 'DOCUMENT_SHARE_LINK_CREATED'", [workspaceId]);
    expect(JSON.stringify(rows[0].payload)).not.toContain(tokenOf(link.path));
  });

  it("rolls the link back when its audit event cannot be written", async () => {
    const { caller, documentId } = await mySpaceDocument();
    const failing = overriding((repositories) => ({
      auditEvents: replacing(repositories.auditEvents, "append", async () => { throw new Error("audit unavailable"); }),
    }));
    await expect(service(failing).create(caller, { documentId })).rejects.toThrow();
    expect(await linkRows(documentId)).toBe(0);
  });

  it("hides another user's My Space document and writes nothing", async () => {
    const { documentId, workspaceId } = await mySpaceDocument();
    const stranger = newIdentity("Stranger");
    await expect(service().create(callerFromIdentity(stranger), { documentId }))
      .rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });
    expect(await linkRows(documentId)).toBe(0);
    expect(await auditRows(workspaceId, "DOCUMENT_SHARE_LINK_CREATED")).toBe(0);
  });

  it("refuses a Team document", async () => {
    const { source, folderId } = await createSourceFixture(pool);
    const { documentId } = await createDocumentFixture(pool, source.id, folderId);
    await expect(service().create(fixtureCaller(), { documentId })).rejects.toMatchObject({ code: "SHARE_LINK_NOT_PERSONAL" });
    expect(await linkRows(documentId)).toBe(0);
  });

  it("shares SOURCE_MANAGED content: ownership decides writing, not sharing", async () => {
    const { owner, caller, workspaceId } = await mySpaceDocument();
    const sourceId = uuidv7();
    const folderId = uuidv7();
    const now = new Date();
    await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      await repositories.sources.insert({
        id: sourceId, name: "Synced Folder", workspaceId, sourceType: "FOLDER_SYNC", ownership: "SOURCE_MANAGED", status: "ACTIVE", syncVersion: 0,
        createdBy: owner.id, updatedBy: owner.id, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
      });
      await repositories.tree.insert({ id: folderId, sourceId, parentId: null, nodeType: "FOLDER", name: "Folder", documentId: null, position: 0, status: "ACTIVE", updatedBy: owner.id, archivedBy: null, archivedAt: null });
    });
    const { documentId } = await createDocumentForAnySource(pool, sourceId, folderId, owner);
    await expect(service().create(caller, { documentId })).resolves.toMatchObject({ active: true });
  });

  it("allows ten active links, refuses the eleventh, and frees a slot on revoke", async () => {
    const { caller, documentId } = await mySpaceDocument();
    const shares = service();
    const links = [];
    for (let index = 0; index < 10; index += 1) links.push(await shares.create(caller, { documentId }));
    await expect(shares.create(caller, { documentId })).rejects.toMatchObject({ code: "SHARE_LINK_LIMIT_REACHED" });
    await shares.revoke(caller, links[0].id);
    await expect(shares.create(caller, { documentId })).resolves.toMatchObject({ active: true });
  });

  it("rejects an expiry outside the allowed set", async () => {
    const { caller, documentId } = await mySpaceDocument();
    await expect(service().create(caller, { documentId, expiresInDays: 2 })).rejects.toMatchObject({ code: "INVALID_SHARE_LINK_EXPIRY" });
  });
});

describe("DocumentShareService.list and revoke (share-link spec §5.4)", () => {
  it("lists every link, revoked ones marked inactive, each with its path", async () => {
    const { caller, documentId } = await mySpaceDocument();
    const shares = service();
    const kept = await shares.create(caller, { documentId, label: "kept" });
    const revoked = await shares.create(caller, { documentId, label: "revoked" });
    await shares.revoke(caller, revoked.id);
    const listed = await shares.list(caller, documentId);
    expect(listed.map((link) => [link.label, link.active, link.path])).toEqual([
      ["revoked", false, revoked.path],
      ["kept", true, kept.path],
    ]);
  });

  it("hides the list from anyone but the My Space owner", async () => {
    const { documentId } = await mySpaceDocument();
    await expect(service().list(callerFromIdentity(newIdentity("Stranger")), documentId)).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });
  });

  it("lets only the creator revoke, and revoking twice records one event", async () => {
    const { caller, documentId, workspaceId } = await mySpaceDocument();
    const shares = service();
    const link = await shares.create(caller, { documentId });
    await expect(shares.revoke(callerFromIdentity(newIdentity("Stranger")), link.id)).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    await shares.revoke(caller, link.id);
    await shares.revoke(caller, link.id);
    expect(await auditRows(workspaceId, "DOCUMENT_SHARE_LINK_REVOKED")).toBe(1);
  });
});

describe("DocumentShareService.readShared (share-link spec §5.2, §5.3, §6.1)", () => {
  it("returns the current revision and who shared it, without any caller", async () => {
    const { caller, documentId } = await mySpaceDocument();
    const shares = service();
    const link = await shares.create(caller, { documentId });
    await expect(shares.readShared(tokenOf(link.path))).resolves.toMatchObject({
      title: "Shared Runbook", markdown: "first body", sharedByName: "Share Owner",
    });
  });

  it("follows the owner's edits (A2)", async () => {
    const { caller, documentId, revisionId } = await mySpaceDocument();
    const shares = service();
    const token = tokenOf((await shares.create(caller, { documentId })).path);
    await new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool)).createRevision(caller, {
      documentId, expectedCurrentRevisionId: revisionId, title: "Shared Runbook v2", markdown: "second body", metadata: {},
    });
    await expect(shares.readShared(token)).resolves.toMatchObject({ title: "Shared Runbook v2", markdown: "second body" });
  });

  it.each([
    ["revoked", async (context: Awaited<ReturnType<typeof mySpaceDocument>>, linkId: string) => {
      await service().revoke(context.caller, linkId);
    }],
    ["expired", async (_: unknown, linkId: string) => {
      await pool.query(
        "UPDATE document_share_links SET created_at = NOW(6) - INTERVAL 2 DAY, expires_at = NOW(6) - INTERVAL 1 SECOND WHERE id = ?", [linkId]);
    }],
    ["document archived", async (context: Awaited<ReturnType<typeof mySpaceDocument>>) => {
      await new MariaDbUnitOfWork(pool).run((repositories) => repositories.documents.updateStatus(context.documentId, "ARCHIVED", context.owner.id));
    }],
    ["source archived", async (context: Awaited<ReturnType<typeof mySpaceDocument>>) => {
      await new MariaDbUnitOfWork(pool).run((repositories) => repositories.sources.updateStatus(context.sourceId, "ARCHIVED", context.owner.id));
    }],
    ["creator lost access", async (context: Awaited<ReturnType<typeof mySpaceDocument>>) => {
      await pool.query("DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?", [context.workspaceId, context.owner.id]);
    }],
  ] as const)("refuses a link once %s", async (_, invalidate) => {
    const context = await mySpaceDocument();
    const shares = service();
    const link = await shares.create(context.caller, { documentId: context.documentId });
    await invalidate(context, link.id);
    await expect(shares.readShared(tokenOf(link.path))).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
  });

  it("refuses an unknown UUIDv4 and a malformed token alike, and a malformed one never reaches the database", async () => {
    const counting = overriding(() => ({}));
    await expect(service(counting).readShared("not-a-token")).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    await expect(service(counting).readShared(uuidv7())).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    expect(counting.runs).toBe(0);
    await expect(service().readShared(crypto.randomUUID())).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
  });

  it("counts views per link per day without identifying anyone", async () => {
    const { caller, documentId } = await mySpaceDocument();
    const shares = service();
    const link = await shares.create(caller, { documentId });
    for (let index = 0; index < 3; index += 1) await shares.readShared(tokenOf(link.path));
    const rows = await pool.query<{ view_count: unknown }[]>("SELECT view_count FROM document_share_link_views WHERE share_link_id = ?", [link.id]);
    expect(rows.map((row) => Number(row.view_count))).toEqual([3]);
    expect((await shares.list(caller, documentId))[0].totalViews).toBe(3);
  });

  it("still serves the document when the view count cannot be written (A5)", async () => {
    const { caller, documentId } = await mySpaceDocument();
    const link = await service().create(caller, { documentId });
    const failing = overriding((repositories) => ({
      shareLinks: replacing(repositories.shareLinks, "recordView", async () => { throw new Error("views unavailable"); }),
    }));
    await expect(service(failing).readShared(tokenOf(link.path))).resolves.toMatchObject({ title: "Shared Runbook" });
  });
});
