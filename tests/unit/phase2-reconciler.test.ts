import { describe, expect, it } from "vitest";
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
});
