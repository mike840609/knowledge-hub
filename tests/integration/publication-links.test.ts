import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildLinkResolver, type CatalogDocument, type LinkOrigin } from "@/modules/knowledge/domain/link-resolution";
import { createPublicationFixture, type PublicationFixture } from "../fixtures/publications";

/**
 * Team publication copies are ordinary documents in a PUBLICATION source, but
 * their path lives in `publication_documents`, not `source_entries`. These
 * tests hold the adapter that lets the one existing resolver read them, and
 * hold that it never invents a path, never crosses a source or Workspace, and
 * that the publication disappears from search when its source is archived.
 */
let fixture: PublicationFixture;
let sequence = 0;

beforeAll(async () => {
  fixture = await createPublicationFixture();
});
afterAll(async () => {
  await fixture.dispose();
});

function unique(prefix: string): string {
  sequence += 1;
  return `${prefix} ${sequence}`;
}

type PublicationTree = {
  sourceId: string;
  publication: Awaited<ReturnType<PublicationFixture["createPublication"]>>;
  originalIds: string[];
  documents: Record<string, string>;
};

async function folderPublication(
  name: string,
  files: readonly { path: string; title: string; markdown: string }[],
): Promise<PublicationTree> {
  const folder = await fixture.createFolder(fixture.mike, `repos/${name.replace(/\s+/g, "-")}`, name);
  const publication = await fixture.createPublication({
    name,
    kind: "FOLDER",
    creator: fixture.mike,
    origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
  });
  const originalIds: string[] = [];
  const documents: Record<string, string> = {};
  for (const file of files) {
    const original = await fixture.createHubOriginal(fixture.mike, unique(`${file.title} original`), "origin");
    originalIds.push(original.documentId);
    const document = await fixture.createTeamDocument({
      publication,
      creatorContributionId: publication.contributionId,
      originalDocumentId: original.documentId,
      sourcePath: file.path,
      title: file.title,
      markdown: file.markdown,
    });
    documents[file.path] = document.teamDocumentId;
  }
  return { sourceId: publication.sourceId, publication, originalIds, documents };
}

function originOf(tree: PublicationTree, path: string): LinkOrigin {
  return {
    documentId: tree.documents[path],
    sourceId: tree.sourceId,
    sourcePath: path,
  };
}

async function catalogOf(workspaceId: string): Promise<CatalogDocument[]> {
  return fixture.uow.run((repositories) => repositories.links.loadCatalog(workspaceId));
}

describe("publication link and path adapters", () => {
  it("resolves a relative Markdown link inside the same publication only", async () => {
    const first = await folderPublication(unique("HCM KM"), [
      { path: "docs/a.md", title: "A 設計", markdown: "see [B](b.md)" },
      { path: "docs/b.md", title: "B 設計", markdown: "body" },
    ]);
    const second = await folderPublication(unique("Payroll"), [
      { path: "docs/b.md", title: "B 設計", markdown: "body" },
    ]);
    const third = await folderPublication(unique("No sibling"), [
      { path: "docs/a.md", title: "A 設計", markdown: "see [B](b.md)" },
    ]);
    const catalog = await catalogOf(fixture.teamWorkspaceId);
    const resolver = buildLinkResolver(catalog);

    expect(resolver.resolve({ kind: "PATH", target: "b.md" }, originOf(first, "docs/a.md")))
      .toEqual({ status: "RESOLVED", documentId: first.documents["docs/b.md"], ambiguousWith: 0 });
    // A relative path only looks inside the origin's own publication: the same
    // `docs/b.md` in another publication is never the answer.
    expect(resolver.resolve({ kind: "PATH", target: "b.md" }, originOf(third, "docs/a.md")))
      .toEqual({ status: "UNRESOLVED" });
    expect(second.documents["docs/b.md"]).not.toBe(first.documents["docs/b.md"]);
  });

  it("keeps a Hub/single-document copy path NULL so its relative links stay unresolved", async () => {
    const original = await fixture.createHubOriginal(fixture.mike, unique("Hub original"), "body");
    const publication = await fixture.createPublication({
      name: unique("Single copy"),
      kind: "DOCUMENT",
      creator: fixture.mike,
      origin: { kind: "DOCUMENT", documentId: original.documentId },
    });
    const copy = await fixture.createTeamDocument({
      publication,
      creatorContributionId: publication.contributionId,
      originalDocumentId: original.documentId,
      sourcePath: null,
      title: "Hub copy",
      markdown: "see [B](b.md)",
    });
    const catalog = await catalogOf(fixture.teamWorkspaceId);
    const entry = catalog.find((candidate) => candidate.documentId === copy.teamDocumentId);
    expect(entry?.sourcePath).toBeNull();
    expect(buildLinkResolver(catalog).resolve(
      { kind: "PATH", target: "b.md" },
      { documentId: copy.teamDocumentId, sourceId: publication.sourceId, sourcePath: entry?.sourcePath ?? null },
    )).toEqual({ status: "UNRESOLVED" });
  });

  it("prefers the same publication's wikilink target and never crosses Workspaces", async () => {
    const first = await folderPublication(unique("Runbook source"), [
      { path: "one.md", title: "環境手冊", markdown: "[[環境手冊]]" },
      { path: "two.md", title: "共用名稱", markdown: "body" },
    ]);
    const second = await folderPublication(unique("Other source"), [
      { path: "other.md", title: "共用名稱", markdown: "body" },
    ]);
    const personal = await fixture.createHubOriginal(fixture.mike, "共用名稱", "personal");
    const catalog = await catalogOf(fixture.teamWorkspaceId);
    const resolver = buildLinkResolver(catalog);
    const resolved = resolver.resolve({ kind: "WIKI", target: "共用名稱" }, originOf(first, "one.md"));
    expect(resolved).toMatchObject({ status: "RESOLVED", documentId: first.documents["two.md"] });
    // Another team source is a candidate only when the same source has none.
    expect(resolver.resolve({ kind: "WIKI", target: "共用名稱" }, originOf(second, "other.md")))
      .toMatchObject({ status: "RESOLVED", documentId: second.documents["other.md"] });
    // A personal document is in another Workspace's catalog and is never offered here.
    expect(catalog.some((candidate) => candidate.documentId === personal.documentId)).toBe(false);
  });

  it("leaves an unpublished target unresolved instead of publishing it", async () => {
    const tree = await folderPublication(unique("Unpublished target"), [
      { path: "a.md", title: "A", markdown: "[[Not In The Team]]" },
    ]);
    const catalog = await catalogOf(fixture.teamWorkspaceId);
    expect(buildLinkResolver(catalog).resolve(
      { kind: "WIKI", target: "Not In The Team" },
      originOf(tree, "a.md"),
    )).toEqual({ status: "UNRESOLVED" });
    // Nothing was created by resolving it.
    expect(catalog.filter((candidate) => candidate.title === "Not In The Team")).toEqual([]);
  });

  it("finds publication copies in search and by path, and hides them when the source is archived", async () => {
    const token = unique("Searchable publication");
    const tree = await folderPublication(token, [
      { path: "docs/guide.md", title: `${token} 指南`, markdown: `${token} 的內容` },
      { path: "docs/nested/deep.md", title: `${token} 深處`, markdown: `${token} 深處內容` },
    ]);
    const search = (filters?: { path: string | null }) => fixture.uow.run((repositories) => repositories.search.search({
      terms: [token],
      filters: filters
        ? { path: filters.path, updatedFrom: null, updatedBefore: null, sort: "relevance" }
        : undefined,
      workspaceIds: [fixture.teamWorkspaceId],
      sourceId: null,
      includeArchived: false,
      limit: 20,
      offset: 0,
    }));
    expect((await search()).map((row) => row.documentId).sort()).toEqual(Object.values(tree.documents).sort());
    expect((await search({ path: "docs" })).map((row) => row.documentId).sort())
      .toEqual(Object.values(tree.documents).sort());
    expect((await search({ path: "docs/nested" })).map((row) => row.documentId))
      .toEqual([tree.documents["docs/nested/deep.md"]]);

    await fixture.pool.query(
      "UPDATE knowledge_sources SET status = 'ARCHIVED', archived_by = ?, archived_at = NOW(6) WHERE id = ?",
      [fixture.mike.identity.id, tree.sourceId],
    );
    expect(await search()).toEqual([]);
  });

  it("reads a copy's path through the entry adapter and keeps its entry write-only source", async () => {
    const tree = await folderPublication(unique("Entry adapter"), [
      { path: "docs/read.md", title: "Read path", markdown: "body" },
    ]);
    const teamDocumentId = tree.documents["docs/read.md"];
    const path = await fixture.uow.run((repositories) => repositories.entries.findSourcePathByDocumentId(teamDocumentId));
    expect(path).toBe("docs/read.md");
    // There is no SourceEntry row to update: a publication copy is written by the
    // publication mechanism under its lock, never by a linked-entry write.
    expect(await fixture.uow.run((repositories) => repositories.entries.findByDocumentId(teamDocumentId))).toBeNull();
    expect(await fixture.uow.run((repositories) => repositories.linkedEntries.findByDocumentId(teamDocumentId))).toBeNull();

    const hubOriginal = await fixture.createHubOriginal(fixture.mike, unique("Hub no path"), "body");
    expect(await fixture.uow.run((repositories) => repositories.entries.findSourcePathByDocumentId(hubOriginal.documentId)))
      .toBeNull();
  });
});
