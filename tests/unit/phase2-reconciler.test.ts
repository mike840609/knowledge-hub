import { describe, expect, it } from "vitest";
import { normalizeFolderName } from "@/modules/knowledge/domain/tree-rules";
import { reconcileFolderImport } from "@/modules/sources/domain/import-reconciler";
import type {
  CanonicalAssetState,
  CanonicalDocumentState,
  CanonicalFolderState,
  CanonicalImportState,
  ReadyImportAsset,
  ReadyImportContent,
  ReadyImportDocument,
} from "@/modules/sources/domain/import-plan";

const binding = {
  workspaceId: "0199f500-0000-7000-8000-000000000001",
  sourceId: "0199f500-0000-7000-8000-000000000002",
  basedOnVersion: 7,
};

function incomingDocument(
  sourcePath: string,
  reconciliationFingerprint: string,
  input: Partial<ReadyImportDocument> = {},
): ReadyImportDocument {
  return {
    sourcePath,
    externalId: null,
    title: "Stable title",
    markdown: "Stable body\n",
    metadata: {},
    revisionContentHash: `revision:${reconciliationFingerprint}`,
    reconciliationFingerprint,
    diagnostics: [],
    ...input,
  };
}

function currentDocument(
  sourcePath: string,
  reconciliationFingerprint: string,
  input: Partial<CanonicalDocumentState> = {},
): CanonicalDocumentState {
  return {
    entryId: `entry:${sourcePath}`,
    documentId: `document:${sourcePath}`,
    treeNodeId: `tree:${sourcePath}`,
    externalId: null,
    sourcePath,
    status: "ACTIVE",
    currentRevision: {
      id: `revision:${sourcePath}`,
      title: "Stable title",
      markdown: "Stable body\n",
      metadata: {},
      contentHash: `revision:${reconciliationFingerprint}`,
    },
    reconciliationFingerprint,
    ...input,
  };
}

function incomingAsset(sourcePath: string, contentHash: string): ReadyImportAsset {
  return {
    sourcePath,
    sourcePathHash: `path:${sourcePath}`,
    contentHash,
    mimeType: "image/png",
    metadata: { size: 10 },
    diagnostics: [],
  };
}

function currentAsset(sourcePath: string, contentHash: string): CanonicalAssetState {
  return {
    id: `asset:${sourcePath}`,
    sourcePath,
    sourcePathHash: `path:${sourcePath}`,
    contentHash,
    mimeType: "image/png",
    metadata: { size: 10 },
  };
}

function currentFolder(sourcePath: string, status: "ACTIVE" | "ARCHIVED" = "ACTIVE"): CanonicalFolderState {
  return {
    entryId: `folder-entry:${sourcePath}`,
    treeNodeId: `folder-tree:${sourcePath}`,
    sourcePath,
    status,
  };
}

function snapshot(documents: ReadyImportDocument[] = [], assets: ReadyImportAsset[] = []): ReadyImportContent {
  return { sourceBinding: binding, documents, assets };
}

function canonical(input: Partial<CanonicalImportState> = {}): CanonicalImportState {
  return { documents: [], folders: [], assets: [], ...input };
}

describe("Phase 2 folder import reconciliation", () => {
  it("matches exact path first and revises changed canonical content", () => {
    const existing = currentDocument("docs/a.md", "old", {
      currentRevision: {
        id: "revision:a",
        title: "Old title",
        markdown: "Old body\n",
        metadata: {},
        contentHash: "revision:old",
      },
    });
    const incoming = incomingDocument("docs/a.md", "new", {
      title: "New title",
      markdown: "New body\n",
      revisionContentHash: "revision:new",
    });

    const plan = reconcileFolderImport(snapshot([incoming]), canonical({ documents: [existing], folders: [currentFolder("docs")] }));

    expect(plan.documents.create).toHaveLength(0);
    expect(plan.documents.revise).toEqual([
      expect.objectContaining({ entryId: existing.entryId, documentId: existing.documentId, expectedCurrentRevisionId: "revision:a" }),
    ]);
    expect(plan.documents.updateLocator).toEqual([
      expect.objectContaining({ entryId: existing.entryId, sourcePath: "docs/a.md", contentHash: "revision:new" }),
    ]);
    expect(plan.preview.find((item) => item.kind === "DOCUMENT")?.labels).toEqual(["UPDATED"]);
  });

  it("preserves one unique fingerprint identity across move and rename", () => {
    const existing = currentDocument("docs/a.md", "same");
    const incoming = incomingDocument("guide/b.md", "same");

    const plan = reconcileFolderImport(
      snapshot([incoming]),
      canonical({ documents: [existing], folders: [currentFolder("docs")] }),
    );

    expect(plan.documents.create).toHaveLength(0);
    expect(plan.documents.move).toEqual([
      expect.objectContaining({ entryId: existing.entryId, treeNodeId: existing.treeNodeId, fromPath: "docs/a.md", toPath: "guide/b.md" }),
    ]);
    expect(plan.documents.revise).toHaveLength(0);
    expect(plan.preview.find((item) => item.kind === "DOCUMENT")?.labels).toEqual(["MOVED", "RENAMED"]);
  });

  it("does not guess ambiguous fingerprint identity", () => {
    const left = currentDocument("a.md", "same");
    const right = currentDocument("b.md", "same");
    const plan = reconcileFolderImport(snapshot([incomingDocument("guide/c.md", "same")]), canonical({ documents: [left, right] }));

    expect(plan.documents.create).toHaveLength(1);
    expect(plan.documents.archive).toHaveLength(2);
    expect(plan.preview.flatMap((item) => item.diagnostics).map((item) => item.code)).toContain("AMBIGUOUS_IDENTITY");
  });

  it("keeps the canonical-side ambiguity shape when two canonical entries share one incoming fingerprint", () => {
    const left = currentDocument("a.md", "same");
    const right = currentDocument("b.md", "same");
    const plan = reconcileFolderImport(snapshot([incomingDocument("guide/c.md", "same")]), canonical({ documents: [left, right] }));

    expect(plan.documents.create).toEqual([expect.objectContaining({ sourcePath: "guide/c.md" })]);
    expect(plan.documents.move).toHaveLength(0);
    expect(plan.documents.revise).toHaveLength(0);
    expect(plan.documents.archive.map((item) => item.sourcePath)).toEqual(["a.md", "b.md"]);

    const ambiguous = plan.preview.flatMap((item) => item.diagnostics).filter((item) => item.code === "AMBIGUOUS_IDENTITY");
    expect(ambiguous).toEqual([
      expect.objectContaining({
        severity: "WARNING",
        sourcePath: "guide/c.md",
        details: { candidates: ["a.md", "b.md"] },
      }),
    ]);
    expect(plan.summary.warnings).toBe(1);
  });

  it("does not guess identity when two incoming files claim the same canonical fingerprint", () => {
    const existing = currentDocument("a.md", "same");
    const plan = reconcileFolderImport(
      snapshot([incomingDocument("c.md", "same"), incomingDocument("d.md", "same")]),
      canonical({ documents: [existing] }),
    );

    expect(plan.documents.create.map((item) => item.sourcePath)).toEqual(["c.md", "d.md"]);
    expect(plan.documents.move).toHaveLength(0);
    expect(plan.documents.revise).toHaveLength(0);
    expect(plan.documents.restore).toHaveLength(0);
    expect(plan.documents.archive).toEqual([
      expect.objectContaining({ entryId: existing.entryId, sourcePath: "a.md" }),
    ]);

    const ambiguous = plan.preview.flatMap((item) => item.diagnostics).filter((item) => item.code === "AMBIGUOUS_IDENTITY");
    expect(ambiguous).toEqual([
      expect.objectContaining({ severity: "WARNING", sourcePath: "c.md", details: { candidates: ["a.md"] } }),
      expect.objectContaining({ severity: "WARNING", sourcePath: "d.md", details: { candidates: ["a.md"] } }),
    ]);
    expect(plan.summary).toMatchObject({ warnings: 2, blockers: 0 });
    expect(plan.summary.documents).toMatchObject({ added: 2, archived: 1, moved: 0, renamed: 0 });
  });

  it("lets an exact path claim win over a competing fingerprint claim", () => {
    const renamedSource = currentDocument("a.md", "same");
    const keptInPlace = currentDocument("keep.md", "same");
    const plan = reconcileFolderImport(
      snapshot([incomingDocument("keep.md", "same"), incomingDocument("renamed.md", "same")]),
      canonical({ documents: [renamedSource, keptInPlace] }),
    );

    expect(plan.documents.create).toHaveLength(0);
    expect(plan.documents.archive).toHaveLength(0);
    expect(plan.documents.move).toEqual([
      expect.objectContaining({ entryId: renamedSource.entryId, fromPath: "a.md", toPath: "renamed.md" }),
    ]);
    expect(plan.preview.flatMap((item) => item.diagnostics)).toHaveLength(0);
  });

  it("still reuses a unique fingerprint identity when other incoming files carry other fingerprints", () => {
    const existing = currentDocument("a.md", "one");
    const plan = reconcileFolderImport(
      snapshot([incomingDocument("renamed.md", "one"), incomingDocument("other.md", "two")]),
      canonical({ documents: [existing] }),
    );

    expect(plan.documents.move).toEqual([
      expect.objectContaining({ entryId: existing.entryId, fromPath: "a.md", toPath: "renamed.md" }),
    ]);
    expect(plan.documents.create.map((item) => item.sourcePath)).toEqual(["other.md"]);
    expect(plan.documents.archive).toHaveLength(0);
    expect(plan.preview.flatMap((item) => item.diagnostics)).toHaveLength(0);
  });

  it("composes MOVED with UPDATED for a relocated document whose revision content changed", () => {
    const existing = currentDocument("docs/a.md", "same");
    const incoming = incomingDocument("guide/a.md", "same", {
      title: "Retitled",
      revisionContentHash: "revision:moved",
    });

    const plan = reconcileFolderImport(
      snapshot([incoming]),
      canonical({ documents: [existing], folders: [currentFolder("docs")] }),
    );

    expect(plan.documents.move).toEqual([
      expect.objectContaining({ entryId: existing.entryId, fromPath: "docs/a.md", toPath: "guide/a.md" }),
    ]);
    expect(plan.documents.revise).toEqual([
      expect.objectContaining({ entryId: existing.entryId, expectedCurrentRevisionId: "revision:docs/a.md" }),
    ]);
    expect(plan.preview.find((item) => item.kind === "DOCUMENT")?.labels).toEqual(["MOVED", "UPDATED"]);
    expect(plan.summary.documents).toMatchObject({ moved: 1, updated: 1, renamed: 0, added: 0 });
  });

  it("composes RESTORED with UPDATED for an archived document that returns with new content", () => {
    const existing = currentDocument("docs/a.md", "same", { status: "ARCHIVED" });
    const incoming = incomingDocument("docs/a.md", "same", {
      title: "Retitled",
      revisionContentHash: "revision:restored",
    });

    const plan = reconcileFolderImport(
      snapshot([incoming]),
      canonical({ documents: [existing], folders: [currentFolder("docs")] }),
    );

    expect(plan.documents.restore).toEqual([
      { entryId: existing.entryId, documentId: existing.documentId, treeNodeId: existing.treeNodeId },
    ]);
    expect(plan.documents.revise).toEqual([
      expect.objectContaining({ entryId: existing.entryId, expectedCurrentRevisionId: "revision:docs/a.md" }),
    ]);
    expect(plan.documents.move).toHaveLength(0);
    expect(plan.preview.find((item) => item.kind === "DOCUMENT")?.labels).toEqual(["RESTORED", "UPDATED"]);
    expect(plan.summary.documents).toMatchObject({ restored: 1, updated: 1, added: 0 });
  });

  it("restores archived exact-path document with the same stable IDs", () => {
    const existing = currentDocument("docs/a.md", "same", { status: "ARCHIVED" });
    const plan = reconcileFolderImport(
      snapshot([incomingDocument("docs/a.md", "same")]),
      canonical({ documents: [existing], folders: [currentFolder("docs")] }),
    );

    expect(plan.documents.restore).toEqual([
      { entryId: existing.entryId, documentId: existing.documentId, treeNodeId: existing.treeNodeId },
    ]);
    expect(plan.documents.revise).toHaveLength(0);
    expect(plan.documents.create).toHaveLength(0);
    expect(plan.preview.find((item) => item.kind === "DOCUMENT")?.labels).toEqual(["RESTORED"]);
  });

  it("treats folder identity as exact path while preserving matched document identity", () => {
    const existing = currentDocument("old/a.md", "same");
    const plan = reconcileFolderImport(
      snapshot([incomingDocument("new/a.md", "same")]),
      canonical({ documents: [existing], folders: [currentFolder("old")] }),
    );

    expect(plan.folders.create).toEqual([expect.objectContaining({ sourcePath: "new" })]);
    expect(plan.folders.archive).toEqual([expect.objectContaining({ sourcePath: "old" })]);
    expect(plan.documents.move).toEqual([expect.objectContaining({ entryId: existing.entryId, toPath: "new/a.md" })]);
  });

  it("matches assets by path only and models a same-hash rename as remove plus add", () => {
    const plan = reconcileFolderImport(
      snapshot([], [incomingAsset("images/new.png", "same-hash")]),
      canonical({ assets: [currentAsset("images/old.png", "same-hash")] }),
    );

    expect(plan.assets.upsert).toEqual([expect.objectContaining({ sourcePath: "images/new.png" })]);
    expect(plan.assets.remove).toEqual([{ assetId: "asset:images/old.png", sourcePath: "images/old.png" }]);
    expect(plan.preview.find((item) => item.kind === "ASSET" && item.sourcePath === "images/new.png")?.labels).toEqual(["ADDED"]);
    expect(plan.preview.find((item) => item.kind === "ASSET" && item.sourcePath === "images/old.png")?.labels).toEqual(["REMOVED"]);
  });

  it("blocks external-id and path resolving to different documents", () => {
    const byExternal = currentDocument("elsewhere.md", "one", { externalId: "X" });
    const byPath = currentDocument("a.md", "two", { externalId: "Y" });
    const incoming = incomingDocument("a.md", "incoming", { externalId: "X" });

    expect(() => reconcileFolderImport(snapshot([incoming]), canonical({ documents: [byExternal, byPath] }))).toThrowError(
      expect.objectContaining({ code: "IDENTITY_CONFLICT" }),
    );
  });

  it("rejects duplicate external IDs in one snapshot", () => {
    const left = incomingDocument("a.md", "one", { externalId: "X" });
    const right = incomingDocument("b.md", "two", { externalId: "X" });
    expect(() => reconcileFolderImport(snapshot([left, right]), canonical())).toThrowError(
      expect.objectContaining({ code: "IDENTITY_CONFLICT" }),
    );
  });

  it("orders desired siblings deterministically with folders before documents", () => {
    const plan = reconcileFolderImport(
      snapshot([
        incomingDocument("b.md", "b"),
        incomingDocument("z/inside.md", "inside"),
        incomingDocument("a.md", "a"),
      ]),
      canonical(),
    );

    expect(plan.ordering.filter((item) => item.parentPath === null)).toEqual([
      { nodeKey: "folder:z", parentPath: null, position: 0 },
      { nodeKey: "document:a.md", parentPath: null, position: 1 },
      { nodeKey: "document:b.md", parentPath: null, position: 2 },
    ]);
  });

  it("returns byte-for-byte equivalent plans for repeated identical input", () => {
    const content = snapshot([
      incomingDocument("z.md", "z"),
      incomingDocument("a.md", "a"),
    ]);
    const state = canonical({ documents: [currentDocument("old.md", "old")] });

    expect(reconcileFolderImport(content, state)).toEqual(reconcileFolderImport(content, state));
  });

  it("reconciles 1,000 documents with lookup-map matching", () => {
    const documents = Array.from({ length: 1000 }, (_, index) => incomingDocument(`docs/${String(index).padStart(4, "0")}.md`, `fp-${index}`));
    const plan = reconcileFolderImport({ sourceBinding: binding, documents, assets: [] }, { documents: [], folders: [], assets: [] });
    expect(plan.documents.create).toHaveLength(1000);
    expect(plan.summary.documents.added).toBe(1000);
  });

  it("blocks a file replaced by a folder at the same source path", () => {
    const existing = currentDocument("guide.md", "old");
    const plan = reconcileFolderImport(
      snapshot([incomingDocument("guide.md/child.md", "new")]),
      canonical({ documents: [existing] }),
    );

    const blockers = plan.preview.flatMap((item) => item.diagnostics).filter((item) => item.severity === "BLOCKING");
    expect(blockers.map((item) => item.code)).toContain("SOURCE_PATH_TYPE_CONFLICT");
    expect(blockers.find((item) => item.code === "SOURCE_PATH_TYPE_CONFLICT")?.sourcePath).toBe("guide.md");
    expect(plan.summary.blockers).toBeGreaterThan(0);
  });

  it("blocks a folder replaced by a file at the same source path", () => {
    const existing = currentDocument("guide.md/child.md", "same");
    const plan = reconcileFolderImport(
      snapshot([incomingDocument("guide.md", "other")]),
      canonical({ documents: [existing], folders: [currentFolder("guide.md")] }),
    );

    const blockers = plan.preview.flatMap((item) => item.diagnostics).filter((item) => item.severity === "BLOCKING");
    expect(blockers.map((item) => item.code)).toContain("SOURCE_PATH_TYPE_CONFLICT");
    expect(blockers.find((item) => item.code === "SOURCE_PATH_TYPE_CONFLICT")?.sourcePath).toBe("guide.md");
    expect(plan.summary.blockers).toBeGreaterThan(0);
  });

  it("blocks a snapshot that uses one path as both document and folder", () => {
    const plan = reconcileFolderImport(
      snapshot([incomingDocument("a.md", "one"), incomingDocument("a.md/b.md", "two")]),
      canonical(),
    );

    const blockers = plan.preview.flatMap((item) => item.diagnostics).filter((item) => item.severity === "BLOCKING");
    expect(blockers.map((item) => item.code)).toContain("SOURCE_PATH_TYPE_CONFLICT");
    expect(plan.summary.blockers).toBeGreaterThan(0);
  });

  it("leaves an identical resync without cross-type blockers", () => {
    const existing = currentDocument("docs/a.md", "same");
    const plan = reconcileFolderImport(
      snapshot([incomingDocument("docs/a.md", "same")]),
      canonical({ documents: [existing], folders: [currentFolder("docs")] }),
    );

    expect(plan.preview.flatMap((item) => item.diagnostics)).toHaveLength(0);
    expect(plan.preview.find((item) => item.kind === "DOCUMENT")?.labels).toEqual(["UNCHANGED"]);
    expect(plan.summary.blockers).toBe(0);
  });

  it("blocks a materialized folder name that canonical projection would reject", () => {
    const plan = reconcileFolderImport(snapshot([incomingDocument(" /a.md", "space")]), canonical());

    const blockers = plan.preview.flatMap((item) => item.diagnostics).filter((item) => item.severity === "BLOCKING");
    expect(blockers.map((item) => item.code)).toContain("INVALID_FOLDER_NAME");
    expect(blockers.find((item) => item.code === "INVALID_FOLDER_NAME")?.sourcePath).toBe(" ");
    expect(plan.summary.blockers).toBeGreaterThan(0);
  });

  it("mirrors every canonical normalizeFolderName rule at Preview (F4 parity)", () => {
    const folderNames = ["docs", "my folder", "  padded  ", "a-b_c", " ", "   "];
    for (const name of folderNames) {
      let canonicalRejects = false;
      try {
        normalizeFolderName(name);
      } catch {
        canonicalRejects = true;
      }
      const plan = reconcileFolderImport(snapshot([incomingDocument(`${name}/a.md`, `fp:${name}`)]), canonical());
      const blocked = plan.preview
        .flatMap((item) => item.diagnostics)
        .some((item) => item.code === "INVALID_FOLDER_NAME" && item.severity === "BLOCKING");
      expect(blocked, `folder name ${JSON.stringify(name)}`).toBe(canonicalRejects);
    }
  });
});
