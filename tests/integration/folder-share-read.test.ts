import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { RandomShareTokenIssuer } from "@/infrastructure/security/random-share-token-issuer";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { DocumentShareService, type SharedFolderView, type SharedView } from "@/modules/knowledge/application/document-share-service";
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
  return { id, emp_id: `FOLDER-READ-${id}`, name, org_code: "SHARE" };
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
  return { owner, caller, workspaceId: workspace.id, sourceId, hub: new HubKnowledgeCommandServiceImpl(unitOfWork) };
}

/**
 * Shared/
 *   Welcome
 *   Engineering/
 *     Dev setup   (links [[Code review]], [[Outside note]], [[Nothing]])
 *     Code review
 *   FAQ
 * Outside note    (My Space root, outside the shared folder)
 */
async function sharedFolder() {
  const space = await mySpace("Folder Reader Owner");
  const { caller, sourceId, hub } = space;
  const doc = (parentId: string | null, title: string, markdown = `${title} body`) =>
    hub.createDocument(caller, { sourceId, parentId, title, markdown, metadata: {} });
  const { treeNodeId: folderNodeId } = await hub.createFolder(caller, { sourceId, parentId: null, name: "Shared" });
  const welcome = await doc(folderNodeId, "Welcome");
  const { treeNodeId: engineeringId } = await hub.createFolder(caller, { sourceId, parentId: folderNodeId, name: "Engineering" });
  const devSetup = await doc(engineeringId, "Dev setup", "See [[Code review]], [[Outside note]] and [[Nothing]].");
  const codeReview = await doc(engineeringId, "Code review");
  const faq = await doc(folderNodeId, "FAQ");
  const outside = await doc(null, "Outside note");
  const link = await service().createForFolder(caller, { folderNodeId });
  return { ...space, folderNodeId, engineeringId, welcome, devSetup, codeReview, faq, outside, link, token: tokenOf(link.path) };
}

function asFolder(view: SharedView): SharedFolderView {
  if (view.kind !== "FOLDER") throw new Error(`expected a folder view, got ${view.kind}`);
  return view;
}

async function viewCount(linkId: string): Promise<number> {
  const rows = await pool.query<{ n: unknown }[]>("SELECT COALESCE(SUM(view_count), 0) AS n FROM document_share_link_views WHERE share_link_id = ?", [linkId]);
  return Number(rows[0].n);
}

const notFound = { code: "SHARE_LINK_NOT_FOUND" };

describe("TreeRepository.listChain", () => {
  it("returns the node, then each parent in turn, linked through parent_id up to the root", async () => {
    const f = await sharedFolder();
    const chain = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.tree.listChain(f.devSetup.treeNodeId));
    expect(chain.map((node) => node.id)).toEqual([f.devSetup.treeNodeId, f.engineeringId, f.folderNodeId]);
    for (let index = 0; index < chain.length - 1; index += 1) expect(chain[index].parentId).toBe(chain[index + 1].id);
    expect(chain.at(-1)?.parentId).toBeNull();
    expect(chain.map((node) => [node.nodeType, node.status])).toEqual([["DOCUMENT", "ACTIVE"], ["FOLDER", "ACTIVE"], ["FOLDER", "ACTIVE"]]);
  });

  it("returns nothing for a node that does not exist", async () => {
    await expect(new MariaDbUnitOfWork(pool).run((repositories) => repositories.tree.listChain(uuidv7()))).resolves.toEqual([]);
  });
});

describe("DocumentShareService.readShared on a folder link (folder share spec §2, §3)", () => {
  it("lands on the first document depth-first and lists the ACTIVE subtree in order, without Markdown", async () => {
    const f = await sharedFolder();
    const view = asFolder(await service().readShared(f.token));
    expect(view).toMatchObject({ kind: "FOLDER", folderName: "Shared", sharedByName: "Folder Reader Owner", expiresAt: f.link.expiresAt });
    expect(view.tree.map((node) => [node.name, node.kind, node.parentId])).toEqual([
      ["Welcome", "DOCUMENT", null],
      ["Engineering", "FOLDER", null],
      ["Dev setup", "DOCUMENT", f.engineeringId],
      ["Code review", "DOCUMENT", f.engineeringId],
      ["FAQ", "DOCUMENT", null],
    ]);
    expect(view.tree.find((node) => node.name === "Dev setup")).toEqual({
      id: f.devSetup.treeNodeId, parentId: f.engineeringId, kind: "DOCUMENT", name: "Dev setup", documentId: f.devSetup.documentId, pageIcon: null,
    });
    expect(view.tree.find((node) => node.name === "Engineering")?.documentId).toBeNull();
    expect(JSON.stringify(view.tree)).not.toContain("body");
    expect(JSON.stringify(view.tree)).not.toContain("markdown");
    expect(view.document).toMatchObject({ documentId: f.welcome.documentId, title: "Welcome", markdown: "Welcome body", revisionId: f.welcome.revisionId, path: [] });
  });

  it("orders siblings with equal position by id, the same on every call", async () => {
    const f = await sharedFolder();
    await pool.query("UPDATE knowledge_tree_nodes SET position = 0 WHERE id IN (?, ?)", [f.welcome.treeNodeId, f.faq.treeNodeId]);
    const [first, second] = [f.welcome.treeNodeId, f.faq.treeNodeId].sort();
    for (let call = 0; call < 3; call += 1) {
      const view = asFolder(await service().readShared(f.token));
      const roots = view.tree.filter((node) => node.parentId === null && node.kind === "DOCUMENT").map((node) => node.id);
      expect(roots).toEqual([first, second]);
      expect(view.document?.documentId).toBe(first === f.welcome.treeNodeId ? f.welcome.documentId : f.faq.documentId);
    }
  });

  it("opens a reachable deep document by id, with the folders from the shared one down to its parent", async () => {
    const f = await sharedFolder();
    const view = asFolder(await service().readShared(f.token, { documentId: f.codeReview.documentId }));
    expect(view.document).toMatchObject({ documentId: f.codeReview.documentId, title: "Code review", markdown: "Code review body", path: [{ id: f.engineeringId, name: "Engineering" }] });
    expect(view.tree).toHaveLength(5);
  });

  it("refuses, with no fallback, a document outside the folder, in another workspace, archived, unknown or malformed", async () => {
    const f = await sharedFolder();
    const elsewhere = await mySpace("Other Owner");
    const { documentId: foreign } = await elsewhere.hub.createDocument(elsewhere.caller, { sourceId: elsewhere.sourceId, parentId: null, title: "Foreign", markdown: "x", metadata: {} });
    await f.hub.archiveDocument(f.caller, f.faq.documentId);
    for (const documentId of [f.outside.documentId, foreign, f.faq.documentId, uuidv7(), crypto.randomUUID()]) {
      await expect(service().readShared(f.token, { documentId }), documentId).rejects.toMatchObject(notFound);
    }
    const unitOfWork = counting();
    for (const documentId of ["not-a-uuid", "", `${f.welcome.documentId}' OR '1'='1`]) {
      await expect(service(unitOfWork).readShared(f.token, { documentId }), documentId).rejects.toMatchObject(notFound);
    }
    expect(unitOfWork.runs).toBe(0);
  });

  it("does not accept the folder's own node id or a subfolder's id as a document", async () => {
    const f = await sharedFolder();
    for (const documentId of [f.folderNodeId, f.engineeringId, f.welcome.treeNodeId]) {
      await expect(service().readShared(f.token, { documentId })).rejects.toMatchObject(notFound);
    }
  });

  it("stays live: a document added later appears, one moved out disappears and is unreadable by id", async () => {
    const f = await sharedFolder();
    const added = await f.hub.createDocument(f.caller, { sourceId: f.sourceId, parentId: f.engineeringId, title: "Added later", markdown: "new", metadata: {} });
    let view = asFolder(await service().readShared(f.token));
    expect(view.tree.map((node) => node.name)).toContain("Added later");
    await expect(service().readShared(f.token, { documentId: added.documentId })).resolves.toMatchObject({ kind: "FOLDER", document: { title: "Added later" } });

    await f.hub.moveTreeNode(f.caller, { nodeId: f.devSetup.treeNodeId, newParentId: null, newPosition: 0 });
    view = asFolder(await service().readShared(f.token));
    expect(view.tree.map((node) => node.name)).not.toContain("Dev setup");
    await expect(service().readShared(f.token, { documentId: f.devSetup.documentId })).rejects.toMatchObject(notFound);

    await f.hub.moveTreeNode(f.caller, { nodeId: f.devSetup.treeNodeId, newParentId: f.engineeringId, newPosition: 0 });
    await expect(service().readShared(f.token, { documentId: f.devSetup.documentId })).resolves.toMatchObject({ document: { title: "Dev setup" } });
  });

  it("serves an empty folder as an empty tree and no document", async () => {
    const space = await mySpace("Empty Folder Owner");
    const { treeNodeId: folderNodeId } = await space.hub.createFolder(space.caller, { sourceId: space.sourceId, parentId: null, name: "Empty" });
    const only = await space.hub.createDocument(space.caller, { sourceId: space.sourceId, parentId: folderNodeId, title: "Only", markdown: "x", metadata: {} });
    const token = tokenOf((await service().createForFolder(space.caller, { folderNodeId })).path);
    await space.hub.moveTreeNode(space.caller, { nodeId: only.treeNodeId, newParentId: null, newPosition: 0 });
    await expect(service().readShared(token)).resolves.toEqual({
      kind: "FOLDER", folderName: "Empty", tree: [], document: null, sharedByName: "Empty Folder Owner", expiresAt: expect.any(Date),
    });
  });

  it.each([
    ["revoked", async (f: Awaited<ReturnType<typeof sharedFolder>>) => { await service().revoke(f.caller, f.link.id); }],
    ["expired", async (f: Awaited<ReturnType<typeof sharedFolder>>) => {
      await pool.query("UPDATE document_share_links SET created_at = NOW(6) - INTERVAL 2 DAY, expires_at = NOW(6) - INTERVAL 1 SECOND WHERE id = ?", [f.link.id]);
    }],
    ["the folder is archived", async (f: Awaited<ReturnType<typeof sharedFolder>>) => {
      await new MariaDbUnitOfWork(pool).run((repositories) => repositories.tree.updateStatus(f.folderNodeId, "ARCHIVED", f.owner.id));
    }],
    ["the source is archived", async (f: Awaited<ReturnType<typeof sharedFolder>>) => {
      await new MariaDbUnitOfWork(pool).run((repositories) => repositories.sources.updateStatus(f.sourceId, "ARCHIVED", f.owner.id));
    }],
    ["the owner lost the workspace", async (f: Awaited<ReturnType<typeof sharedFolder>>) => {
      await pool.query("DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?", [f.workspaceId, f.owner.id]);
    }],
  ] as const)("refuses the link and every document under it once %s", async (_, invalidate) => {
    const f = await sharedFolder();
    await invalidate(f);
    await expect(service().readShared(f.token)).rejects.toMatchObject(notFound);
    await expect(service().readShared(f.token, { documentId: f.codeReview.documentId })).rejects.toMatchObject(notFound);
  });

  it("guards an intermediate folder archived by a defect: its documents are unreachable", async () => {
    const f = await sharedFolder();
    await new MariaDbUnitOfWork(pool).run((repositories) => repositories.tree.updateStatus(f.engineeringId, "ARCHIVED", f.owner.id));
    const view = asFolder(await service().readShared(f.token));
    expect(view.tree.map((node) => node.name)).toEqual(["Welcome", "FAQ"]);
    await expect(service().readShared(f.token, { documentId: f.codeReview.documentId })).rejects.toMatchObject(notFound);
  });

  it("resolves a document's links only to documents reachable through the link", async () => {
    const f = await sharedFolder();
    const view = asFolder(await service().readShared(f.token, { documentId: f.devSetup.documentId }));
    expect(view.document?.links).toEqual([{ lookupKey: "WIKI:code review", documentId: f.codeReview.documentId, title: "Code review" }]);
    expect(JSON.stringify(view)).not.toContain(f.outside.documentId);
  });

  it("counts one view for every read", async () => {
    const f = await sharedFolder();
    await service().readShared(f.token);
    await service().readShared(f.token, { documentId: f.faq.documentId });
    await service().readShared(f.token, { documentId: f.codeReview.documentId, recordView: false });
    expect(await viewCount(f.link.id)).toBe(2);
  });
});

describe("DocumentShareService.readShared on a document link", () => {
  it("is unchanged without a document id, and refuses any document id, even its own", async () => {
    const f = await sharedFolder();
    const link = await service().create(f.caller, { documentId: f.welcome.documentId });
    await expect(service().readShared(tokenOf(link.path))).resolves.toMatchObject({ kind: "DOCUMENT", title: "Welcome", markdown: "Welcome body", sharedByName: "Folder Reader Owner" });
    for (const documentId of [f.welcome.documentId, f.faq.documentId, uuidv7(), "not-a-uuid"]) {
      await expect(service().readShared(tokenOf(link.path), { documentId }), documentId).rejects.toMatchObject(notFound);
    }
  });
});
