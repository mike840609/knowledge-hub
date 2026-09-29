import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { KnowledgeLinkServiceImpl } from "@/modules/knowledge/application/knowledge-link-service";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { DocumentNotFoundError, RevisionNotFoundError } from "@/modules/knowledge/domain/errors";
import { WorkspaceAccessDeniedError } from "@/modules/workspaces/domain/errors";
import {
  hubDocument,
  linkOutsider,
  linkOwner,
  managedDocument,
  provisionLinkDatabase,
  reviseHubDocument,
  setupLinkScope,
} from "../fixtures/link-graph";

let pool: Pool;
let dispose: () => Promise<void>;
let service: KnowledgeLinkServiceImpl;
const owner = callerFromIdentity(linkOwner);
const outsider = callerFromIdentity(linkOutsider);

beforeAll(async () => {
  ({ pool, dispose } = await provisionLinkDatabase());
  service = new KnowledgeLinkServiceImpl(new MariaDbUnitOfWork(pool));
});
afterAll(async () => {
  await dispose();
});

async function archiveDocument(documentId: string) {
  await pool.query("UPDATE knowledge_documents SET status='ARCHIVED', archived_by=?, archived_at=NOW(6) WHERE id=?", [linkOwner.id, documentId]);
  await pool.query("UPDATE knowledge_tree_nodes SET status='ARCHIVED', archived_by=?, archived_at=NOW(6) WHERE document_id=?", [linkOwner.id, documentId]);
}

describe("getDocumentLinks", () => {
  it("lists backlinks with counts, the source, and the line each sits on, in title order", async () => {
    const scope = await setupLinkScope(pool);
    const target = await hubDocument(pool, scope, "Target", "the target");
    const a = await hubDocument(pool, scope, "Zebra notes", "intro\n\nSee the [[Target]] page for details.\n\nAnd [[target|again]].");
    const b = await hubDocument(pool, scope, "Alpha notes", "- follows [[Target#Setup]]");

    const view = await service.getDocumentLinks(owner, target.documentId);

    expect(view.workspaceId).toBe(scope.workspaceId);
    expect(view.backlinkTotal).toBe(2);
    expect(view.backlinks).toEqual([
      { documentId: b.documentId, sourceId: scope.hubSourceId, sourceName: "Hub Notes", title: "Alpha notes", count: 1, context: "follows Target › Setup" },
      { documentId: a.documentId, sourceId: scope.hubSourceId, sourceName: "Hub Notes", title: "Zebra notes", count: 2, context: "See the Target page for details." },
    ]);
  });

  it("resolves what a document links to, once per distinct link, and lists the unresolved", async () => {
    const scope = await setupLinkScope(pool);
    const known = await hubDocument(pool, scope, "Known", "x");
    const source = await hubDocument(pool, scope, "Source", "[[Known]] again [[known]] and [[Nowhere]] and [[Nowhere#Part]]");

    const view = await service.getDocumentLinks(owner, source.documentId);

    expect(view.outgoing.map((link) => [link.target, link.count, link.resolution.status])).toEqual([
      ["Known", 2, "RESOLVED"],
      ["Nowhere", 2, "UNRESOLVED"],
    ]);
    expect(view.outgoing[0].resolution).toEqual({ status: "RESOLVED", documentId: known.documentId, sourceId: scope.hubSourceId, title: "Known", ambiguousWith: 0 });
    expect(view.unresolved.map((link) => link.target)).toEqual(["Nowhere"]);
  });

  it("resolves at read time: a rename orphans the old name and the new one starts to resolve", async () => {
    const scope = await setupLinkScope(pool);
    const b = await hubDocument(pool, scope, "Old name", "b");
    const a = await hubDocument(pool, scope, "Linker", "see [[Old name]]");
    expect((await service.getDocumentLinks(owner, b.documentId)).backlinks.map((link) => link.title)).toEqual(["Linker"]);

    const renamed = await reviseHubDocument(pool, b.documentId, b.revisionId, "New name", "b");
    expect(renamed.changed).toBe(true);
    // Nothing about Linker was written, yet what it points at changed.
    expect((await service.getDocumentLinks(owner, b.documentId)).backlinks).toEqual([]);
    expect((await service.getDocumentLinks(owner, a.documentId)).unresolved.map((link) => link.target)).toEqual(["Old name"]);

    await reviseHubDocument(pool, a.documentId, a.revisionId, "Linker", "see [[New name]]");
    expect((await service.getDocumentLinks(owner, b.documentId)).backlinks.map((link) => link.title)).toEqual(["Linker"]);
  });

  it("shows the links of the revision asked for", async () => {
    const scope = await setupLinkScope(pool);
    const doc = await hubDocument(pool, scope, "Versioned", "[[First]]");
    await reviseHubDocument(pool, doc.documentId, doc.revisionId, "Versioned", "[[Second]]");
    expect((await service.getDocumentLinks(owner, doc.documentId)).outgoing.map((link) => link.target)).toEqual(["Second"]);
    expect((await service.getDocumentLinks(owner, doc.documentId, { revisionNo: 1 })).outgoing.map((link) => link.target)).toEqual(["First"]);
    await expect(service.getDocumentLinks(owner, doc.documentId, { revisionNo: 9 })).rejects.toBeInstanceOf(RevisionNotFoundError);
  });

  it("reports an ambiguous name and resolves it to the source of the linking document", async () => {
    const scope = await setupLinkScope(pool);
    const inHub = await hubDocument(pool, scope, "Setup", "hub");
    await managedDocument(pool, scope, "vault/setup.md", "Setup", "vault");
    const linker = await hubDocument(pool, scope, "Linker", "[[Setup]]");
    const view = await service.getDocumentLinks(owner, linker.documentId);
    expect(view.outgoing[0].resolution).toMatchObject({ status: "RESOLVED", documentId: inHub.documentId, ambiguousWith: 1 });
  });

  it("indexes and resolves folder-sync documents, including relative .md links", async () => {
    const scope = await setupLinkScope(pool);
    const a = await managedDocument(pool, scope, "notes/a.md", "A", "to [b](b.md), [c](../top/c.md#x) and [[D]]");
    const b = await managedDocument(pool, scope, "notes/b.md", "B", "b");
    const c = await managedDocument(pool, scope, "top/c.md", "C", "c");
    const d = await managedDocument(pool, scope, "elsewhere/d.md", "D", "d");

    const outgoing = (await service.getDocumentLinks(owner, a.documentId)).outgoing;
    expect(outgoing.map((link) => [link.kind, link.target, link.resolution.status === "RESOLVED" ? link.resolution.documentId : null])).toEqual([
      ["PATH", "b.md", b.documentId],
      ["PATH", "../top/c.md", c.documentId],
      ["WIKI", "D", d.documentId],
    ]);
    expect((await service.getDocumentLinks(owner, b.documentId)).backlinks.map((link) => link.documentId)).toEqual([a.documentId]);
  });

  it("does not resolve a link across Workspaces, and the answer is the same as for a title that exists nowhere", async () => {
    const mine = await setupLinkScope(pool);
    const theirs = await setupLinkScope(pool);
    await hubDocument(pool, theirs, "Confidential Plan", "secret");
    const linker = await hubDocument(pool, mine, "Linker", "[[Confidential Plan]] and [[Invented Title]]");

    const view = await service.getDocumentLinks(owner, linker.documentId);
    const [elsewhere, nowhere] = view.outgoing;
    expect(elsewhere.resolution).toEqual({ status: "UNRESOLVED" });
    expect(nowhere.resolution).toEqual({ status: "UNRESOLVED" });
    // Nothing but the text the author wrote tells them apart.
    expect({ ...elsewhere, target: "", lookupKey: "" }).toEqual({ ...nowhere, target: "", lookupKey: "" });
    expect(JSON.stringify(view)).not.toContain("secret");
  });

  it("does not list backlinks from documents in another Workspace", async () => {
    const mine = await setupLinkScope(pool);
    const theirs = await setupLinkScope(pool);
    const target = await hubDocument(pool, mine, "Shared Name", "x");
    await hubDocument(pool, theirs, "Foreign linker", "[[Shared Name]]");
    expect((await service.getDocumentLinks(owner, target.documentId)).backlinks).toEqual([]);
  });

  it("leaves archived documents out, as source and as target", async () => {
    const scope = await setupLinkScope(pool);
    const target = await hubDocument(pool, scope, "Live target", "x");
    const shelved = await hubDocument(pool, scope, "Shelved linker", "[[Live target]]");
    const linker = await hubDocument(pool, scope, "Live linker", "[[Live target]] and [[Shelved target]]");
    const shelvedTarget = await hubDocument(pool, scope, "Shelved target", "y");
    await archiveDocument(shelved.documentId);
    await archiveDocument(shelvedTarget.documentId);

    expect((await service.getDocumentLinks(owner, target.documentId)).backlinks.map((link) => link.title)).toEqual(["Live linker"]);
    const outgoing = (await service.getDocumentLinks(owner, linker.documentId)).outgoing;
    expect(outgoing.map((link) => [link.target, link.resolution.status])).toEqual([["Live target", "RESOLVED"], ["Shelved target", "UNRESOLVED"]]);
    await expect(service.getDocumentLinks(owner, shelved.documentId)).rejects.toBeInstanceOf(DocumentNotFoundError);
    // Asking for archived content shows the document; it still has no backlinks, and its own links resolve without a path.
    expect((await service.getDocumentLinks(owner, shelved.documentId, { includeArchived: true })).outgoing[0].resolution.status).toBe("RESOLVED");
  });

  it("says how much of the index can be trusted", async () => {
    const scope = await setupLinkScope(pool);
    const target = await hubDocument(pool, scope, "Trusted", "x");
    const other = await hubDocument(pool, scope, "Other", "[[Trusted]]");
    expect((await service.getDocumentLinks(owner, target.documentId)).index).toEqual({ documents: 2, stale: 0 });
    await pool.query("DELETE FROM knowledge_document_links WHERE document_id = ?", [other.documentId]);
    await pool.query("DELETE FROM knowledge_link_index WHERE document_id = ?", [other.documentId]);
    const view = await service.getDocumentLinks(owner, target.documentId);
    expect(view.index).toEqual({ documents: 2, stale: 1 });
    // Not indexed means not known, not "no backlinks were ever written": the caller is told.
    expect(view.backlinks).toEqual([]);
  });

  it("carries the document's neighbourhood when asked, from the same read, and not otherwise", async () => {
    const scope = await setupLinkScope(pool);
    const centre = await hubDocument(pool, scope, "Hub centre", "[[Spoke]] [[Void]]");
    await hubDocument(pool, scope, "Spoke", "[[Rim]]");
    await hubDocument(pool, scope, "Rim", "x");

    expect((await service.getDocumentLinks(owner, centre.documentId)).localGraph).toBeNull();
    const one = (await service.getDocumentLinks(owner, centre.documentId, { localGraphDepth: 1 })).localGraph!;
    expect(one.nodes.map((node) => node.title).sort()).toEqual(["Hub centre", "Spoke", "Void"]);
    const two = (await service.getDocumentLinks(owner, centre.documentId, { localGraphDepth: 2 })).localGraph!;
    expect(two.nodes.map((node) => node.title).sort()).toEqual(["Hub centre", "Rim", "Spoke", "Void"]);
    // The same answer as asking for the graph directly.
    const direct = await service.getLocalGraph(owner, centre.documentId, { depth: 2 });
    expect({ nodes: two.nodes, edges: two.edges }).toEqual({ nodes: direct.nodes, edges: direct.edges });
  });

  it("is refused for a caller who is not a member, and does not say whether the document exists", async () => {
    const scope = await setupLinkScope(pool);
    const doc = await hubDocument(pool, scope, "Private", "[[Anything]]");
    await expect(service.getDocumentLinks(outsider, doc.documentId)).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    await expect(service.getDocumentLinks(owner, "0199f000-0000-7000-8000-00000000dead")).rejects.toBeInstanceOf(DocumentNotFoundError);
  });
});

describe("getWorkspaceGraph", () => {
  it("draws the Workspace's documents and the links between them", async () => {
    const scope = await setupLinkScope(pool);
    const a = await hubDocument(pool, scope, "A", "[[B]] [[C]]");
    const b = await hubDocument(pool, scope, "B", "[[A]]");
    const c = await hubDocument(pool, scope, "C", "none");
    const d = await hubDocument(pool, scope, "D", "alone");

    const graph = await service.getWorkspaceGraph(owner, scope.workspaceId);
    expect(new Set(graph.nodes.map((node) => node.id))).toEqual(new Set([a, b, c, d].map((doc) => doc.documentId)));
    expect(graph.edges).toHaveLength(3);
    expect(graph.total).toEqual({ documents: 4, edges: 3 });
    expect(graph.truncated).toBeNull();
    expect(graph.sources.map((source) => source.name).sort()).toEqual(["Hub Notes", "Vault"]);
    expect(graph.index).toEqual({ documents: 4, stale: 0 });
  });

  it("filters by source, and hides orphans and unresolved targets unless asked", async () => {
    const scope = await setupLinkScope(pool);
    await hubDocument(pool, scope, "Hub A", "[[Hub B]] [[Ghost]]");
    await hubDocument(pool, scope, "Hub B", "x");
    await hubDocument(pool, scope, "Hub Orphan", "x");
    await managedDocument(pool, scope, "m.md", "Vault One", "[[Hub A]]");

    const all = await service.getWorkspaceGraph(owner, scope.workspaceId);
    expect(all.nodes).toHaveLength(4);
    expect(all.nodes.every((node) => node.kind === "DOCUMENT")).toBe(true);

    const hubOnly = await service.getWorkspaceGraph(owner, scope.workspaceId, { sourceId: scope.hubSourceId });
    expect(hubOnly.nodes.map((node) => node.title).sort()).toEqual(["Hub A", "Hub B", "Hub Orphan"]);
    expect(hubOnly.edges).toHaveLength(1);

    const connected = await service.getWorkspaceGraph(owner, scope.workspaceId, { includeOrphans: false, includeUnresolved: true });
    expect(connected.nodes.map((node) => node.title).sort()).toEqual(["Ghost", "Hub A", "Hub B", "Vault One"]);
  });

  it("never includes another Workspace's documents or links", async () => {
    const mine = await setupLinkScope(pool);
    const theirs = await setupLinkScope(pool);
    await hubDocument(pool, mine, "Mine", "[[Theirs]]");
    await hubDocument(pool, theirs, "Theirs", "[[Mine]]");
    const graph = await service.getWorkspaceGraph(owner, mine.workspaceId, { includeUnresolved: true });
    expect(graph.nodes.map((node) => node.title).sort()).toEqual(["Mine", "Theirs"]);
    expect(graph.nodes.find((node) => node.title === "Theirs")?.kind).toBe("UNRESOLVED");
    expect(graph.edges).toHaveLength(1);
  });

  it("is refused for a non-member, whatever workspace id is asked for", async () => {
    const scope = await setupLinkScope(pool);
    await expect(service.getWorkspaceGraph(outsider, scope.workspaceId)).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
  });

  it("honours a node limit and never exceeds the hard one", async () => {
    const scope = await setupLinkScope(pool);
    await hubDocument(pool, scope, "Hub", "[[S1]] [[S2]] [[S3]]");
    for (const name of ["S1", "S2", "S3", "L1", "L2"]) await hubDocument(pool, scope, name, "x");
    const graph = await service.getWorkspaceGraph(owner, scope.workspaceId, { limit: 4 });
    expect(graph.nodes).toHaveLength(4);
    expect(graph.truncated).toEqual({ shown: 4, total: 6 });
    const huge = await service.getWorkspaceGraph(owner, scope.workspaceId, { limit: 10_000_000 });
    expect(huge.nodes).toHaveLength(6);
    const nonsense = await service.getWorkspaceGraph(owner, scope.workspaceId, { limit: -5 });
    expect(nonsense.nodes).toHaveLength(1);
  });
});

describe("getLocalGraph", () => {
  it("is the document and its neighbours, including targets that do not exist yet", async () => {
    const scope = await setupLinkScope(pool);
    const centre = await hubDocument(pool, scope, "Centre", "[[Near]] [[Missing]]");
    const near = await hubDocument(pool, scope, "Near", "[[Far]]");
    await hubDocument(pool, scope, "Far", "x");
    await hubDocument(pool, scope, "Unrelated", "x");

    const one = await service.getLocalGraph(owner, centre.documentId);
    expect(one.focusId).toBe(centre.documentId);
    expect(one.nodes[0].id).toBe(centre.documentId);
    expect(one.nodes.map((node) => node.title).sort()).toEqual(["Centre", "Missing", "Near"]);

    const two = await service.getLocalGraph(owner, centre.documentId, { depth: 2 });
    expect(two.nodes.map((node) => node.title).sort()).toEqual(["Centre", "Far", "Missing", "Near"]);
    expect(two.nodes.map((node) => node.id)).toContain(near.documentId);
  });

  it("is refused for a non-member", async () => {
    const scope = await setupLinkScope(pool);
    const doc = await hubDocument(pool, scope, "Private", "x");
    await expect(service.getLocalGraph(outsider, doc.documentId)).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
  });
});
