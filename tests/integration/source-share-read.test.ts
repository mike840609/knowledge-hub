import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { RandomShareTokenIssuer } from "@/infrastructure/security/random-share-token-issuer";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { DocumentShareService, type SharedTreeView, type SharedView } from "@/modules/knowledge/application/document-share-service";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import type { KnowledgeRepositories, KnowledgeUnitOfWork } from "@/modules/knowledge/ports/unit-of-work";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

function newIdentity(name: string): UserIdentity {
  const id = uuidv7();
  return { id, emp_id: `SOURCE-READ-${id}`, name, org_code: "SHARE" };
}

function service(unitOfWork: KnowledgeUnitOfWork = new MariaDbUnitOfWork(pool)) {
  return new DocumentShareService(unitOfWork, new RandomShareTokenIssuer());
}

/** Counts unit-of-work runs, to prove a refusal reached no query. */
function counting(): KnowledgeUnitOfWork & { runs: number } {
  const inner = new MariaDbUnitOfWork(pool);
  const wrapper = {
    runs: 0,
    run<T>(work: (repositories: KnowledgeRepositories) => Promise<T>): Promise<T> {
      wrapper.runs += 1;
      return inner.run(work);
    },
  };
  return wrapper;
}

const tokenOf = (path: string) => path.slice("/s/".length);

async function mySpace(name: string) {
  const owner = newIdentity(name);
  const unitOfWork = new MariaDbUnitOfWork(pool);
  await unitOfWork.run((repositories) => repositories.users.upsertIdentity(owner));
  const { workspace } = await new PersonalWorkspaceService(unitOfWork).ensurePersonalWorkspace(owner.id);
  const caller = callerFromIdentity(owner);
  const sourceId = await ensureDefaultHubSource(unitOfWork, caller, workspace.id);
  return { uow: unitOfWork, owner, caller, workspaceId: workspace.id, sourceId, hub: new HubKnowledgeCommandServiceImpl(unitOfWork) };
}

/**
 * The default Hub Source ("Notes"), as a Source link sees it:
 *   Welcome
 *   Engineering/
 *     Dev setup   (links [[Code review]], [[Outside note]], [[Nothing]])
 *     Code review
 *   FAQ
 * plus "Outside note" in a second Source of the same My Space.
 */
async function sharedSource() {
  const space = await mySpace("Source Reader Owner");
  const { caller, sourceId, hub, workspaceId } = space;
  const doc = (parentId: string | null, title: string, markdown = `${title} body`) =>
    hub.createDocument(caller, { sourceId, parentId, title, markdown, metadata: {} });
  const welcome = await doc(null, "Welcome");
  const { treeNodeId: engineeringId } = await hub.createFolder(caller, { sourceId, parentId: null, name: "Engineering" });
  const devSetup = await doc(engineeringId, "Dev setup", "See [[Code review]], [[Outside note]] and [[Nothing]].");
  const codeReview = await doc(engineeringId, "Code review");
  const faq = await doc(null, "FAQ");
  const otherSourceId = await new MariaDbUnitOfWork(pool).run(async (repositories) => {
    const now = new Date();
    const id = uuidv7();
    await repositories.sources.insert({ id, name: "Other Source", workspaceId, sourceType: "HUB", ownership: "HUB_MANAGED", status: "ACTIVE", syncVersion: 0, createdBy: space.owner.id, updatedBy: space.owner.id, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now });
    return id;
  });
  const outside = await hub.createDocument(caller, { sourceId: otherSourceId, parentId: null, title: "Outside note", markdown: "outside", metadata: {} });
  const link = await service().createForSource(caller, { sourceId });
  return { ...space, engineeringId, welcome, devSetup, codeReview, faq, outside, otherSourceId, link, token: tokenOf(link.path) };
}

function asSource(view: SharedView): SharedTreeView {
  if (view.kind !== "SOURCE") throw new Error(`expected a source view, got ${view.kind}`);
  return view as SharedTreeView;
}

async function viewCount(linkId: string): Promise<number> {
  const rows = await pool.query<{ n: unknown }[]>("SELECT COALESCE(SUM(view_count), 0) AS n FROM document_share_link_views WHERE share_link_id = ?", [linkId]);
  return Number(rows[0].n);
}

const notFound = { code: "SHARE_LINK_NOT_FOUND" };

describe("DocumentShareService.readShared on a source link (source share spec §3)", () => {
  it("lands on the first document depth-first and lists the ACTIVE tree in order, without Markdown", async () => {
    const s = await sharedSource();
    const view = asSource(await service().readShared(s.token));
    expect(view).toMatchObject({ kind: "SOURCE", rootName: "Notes", sharedByName: "Source Reader Owner", expiresAt: s.link.expiresAt });
    expect(view.tree.map((node) => [node.name, node.kind, node.parentId])).toEqual([
      ["Welcome", "DOCUMENT", null],
      ["Engineering", "FOLDER", null],
      ["Dev setup", "DOCUMENT", s.engineeringId],
      ["Code review", "DOCUMENT", s.engineeringId],
      ["FAQ", "DOCUMENT", null],
    ]);
    expect(view.tree.find((node) => node.name === "Dev setup")).toEqual({
      id: s.devSetup.treeNodeId, parentId: s.engineeringId, kind: "DOCUMENT", name: "Dev setup", documentId: s.devSetup.documentId, pageIcon: null,
    });
    expect(view.tree.find((node) => node.name === "Engineering")?.documentId).toBeNull();
    expect(JSON.stringify(view.tree)).not.toContain("body");
    expect(JSON.stringify(view.tree)).not.toContain("markdown");
    expect(view.document).toMatchObject({ documentId: s.welcome.documentId, title: "Welcome", markdown: "Welcome body", revisionId: s.welcome.revisionId, path: [] });
  });

  it("opens a requested top-level and deep document, with the folders from the Source root down", async () => {
    const s = await sharedSource();
    const top = asSource(await service().readShared(s.token, { documentId: s.welcome.documentId }));
    expect(top.document).toMatchObject({ documentId: s.welcome.documentId, title: "Welcome", path: [] });
    const deep = asSource(await service().readShared(s.token, { documentId: s.codeReview.documentId }));
    expect(deep.document).toMatchObject({ documentId: s.codeReview.documentId, title: "Code review", markdown: "Code review body", path: [{ id: s.engineeringId, name: "Engineering" }] });
    expect(deep.tree).toHaveLength(5);
  });

  it("refuses, with no fallback, a document outside the Source, in another workspace, archived, unknown or malformed", async () => {
    const s = await sharedSource();
    const elsewhere = await mySpace("Other Owner");
    const { documentId: foreign } = await elsewhere.hub.createDocument(elsewhere.caller, { sourceId: elsewhere.sourceId, parentId: null, title: "Foreign", markdown: "x", metadata: {} });
    await s.hub.archiveDocument(s.caller, s.faq.documentId);
    for (const documentId of [s.outside.documentId, foreign, s.faq.documentId, uuidv7(), crypto.randomUUID()]) {
      await expect(service().readShared(s.token, { documentId }), documentId).rejects.toMatchObject(notFound);
    }
    const unitOfWork = counting();
    for (const documentId of ["not-a-uuid", "", `${s.welcome.documentId}' OR '1'='1`]) {
      await expect(service(unitOfWork).readShared(s.token, { documentId }), documentId).rejects.toMatchObject(notFound);
    }
    expect(unitOfWork.runs).toBe(0);
  });

  it("names the Open destination in one narrow read, falling back to landing for an unreachable ?d=", async () => {
    const s = await sharedSource();
    expect(await service().readSharedTarget(s.token)).toEqual({ kind: "SOURCE", documentId: s.welcome.documentId, audience: "LINK" });
    expect(await service().readSharedTarget(s.token, { documentId: s.codeReview.documentId })).toEqual({ kind: "SOURCE", documentId: s.codeReview.documentId, audience: "LINK" });
    expect(await service().readSharedTarget(s.token, { documentId: s.outside.documentId })).toEqual({ kind: "SOURCE", documentId: s.welcome.documentId, audience: "LINK" });
  });

  it("stays live: a document added later appears, an archived one disappears and is unreadable by id", async () => {
    const s = await sharedSource();
    const added = await s.hub.createDocument(s.caller, { sourceId: s.sourceId, parentId: s.engineeringId, title: "Added later", markdown: "new", metadata: {} });
    let view = asSource(await service().readShared(s.token));
    expect(view.tree.map((node) => node.name)).toContain("Added later");
    await expect(service().readShared(s.token, { documentId: added.documentId })).resolves.toMatchObject({ kind: "SOURCE", document: { title: "Added later" } });

    await s.hub.archiveDocument(s.caller, added.documentId);
    view = asSource(await service().readShared(s.token));
    expect(view.tree.map((node) => node.name)).not.toContain("Added later");
    await expect(service().readShared(s.token, { documentId: added.documentId })).rejects.toMatchObject(notFound);
  });

  it("serves an empty Source and a folders-only Source as an empty document and no error", async () => {
    const space = await mySpace("Empty Source Owner");
    const token = tokenOf((await service().createForSource(space.caller, { sourceId: space.sourceId })).path);
    await expect(service().readShared(token)).resolves.toEqual({
      kind: "SOURCE", rootName: "Notes", tree: [], document: null, sharedByName: "Empty Source Owner", expiresAt: expect.any(Date), audience: "LINK",
    });
    await expect(service().readSharedTarget(token)).resolves.toEqual({ kind: "SOURCE", documentId: null, audience: "LINK" });

    await space.hub.createFolder(space.caller, { sourceId: space.sourceId, parentId: null, name: "Only folder" });
    const foldersOnly = asSource(await service().readShared(token));
    expect(foldersOnly.tree.map((node) => node.kind)).toEqual(["FOLDER"]);
    expect(foldersOnly.tree.every((node) => node.documentId === null)).toBe(true);
    expect(foldersOnly.document).toBeNull();
  });

  it("keeps the link across a rename, and closes and reopens it with the Source", async () => {
    const s = await sharedSource();
    await new MariaDbUnitOfWork(pool).run((repositories) => repositories.sources.updateName(s.sourceId, "Renamed notes", s.owner.id));
    const renamed = asSource(await service().readShared(s.token));
    expect(renamed.rootName).toBe("Renamed notes");
    expect(renamed.document?.title).toBe("Welcome");

    await new MariaDbUnitOfWork(pool).run((repositories) => repositories.sources.updateStatus(s.sourceId, "ARCHIVED", s.owner.id));
    await expect(service().readShared(s.token)).rejects.toMatchObject(notFound);
    await expect(service().readSharedTarget(s.token)).rejects.toMatchObject(notFound);

    await new MariaDbUnitOfWork(pool).run((repositories) => repositories.sources.updateStatus(s.sourceId, "ACTIVE", s.owner.id));
    const restored = asSource(await service().readShared(s.token));
    expect(restored.rootName).toBe("Renamed notes");
    expect(restored.document?.title).toBe("Welcome");
  });

  it("resolves a document's links only to documents inside the Source", async () => {
    const s = await sharedSource();
    const view = asSource(await service().readShared(s.token, { documentId: s.devSetup.documentId }));
    expect(view.document?.links).toEqual([{ lookupKey: "WIKI:code review", documentId: s.codeReview.documentId, title: "Code review" }]);
    expect(JSON.stringify(view)).not.toContain(s.outside.documentId);
  });

  it("counts one view for every read", async () => {
    const s = await sharedSource();
    await service().readShared(s.token);
    await service().readShared(s.token, { documentId: s.faq.documentId });
    await service().readShared(s.token, { documentId: s.codeReview.documentId, recordView: false });
    expect(await viewCount(s.link.id)).toBe(2);
  });
});

describe("DocumentShareService.readShared on a document link", () => {
  it("is unchanged without a document id, and refuses any document id, even its own", async () => {
    const s = await sharedSource();
    const link = await service().create(s.caller, { documentId: s.welcome.documentId });
    await expect(service().readShared(tokenOf(link.path))).resolves.toMatchObject({ kind: "DOCUMENT", title: "Welcome", markdown: "Welcome body", sharedByName: "Source Reader Owner" });
    for (const documentId of [s.welcome.documentId, s.faq.documentId, uuidv7(), "not-a-uuid"]) {
      await expect(service().readShared(tokenOf(link.path), { documentId }), documentId).rejects.toMatchObject(notFound);
    }
  });
});
