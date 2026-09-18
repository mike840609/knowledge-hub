import { createHash } from "node:crypto";
import { MariaDbImportCanonicalStateRepository } from "@/infrastructure/database/mariadb/repositories/import-canonical-state";
import { fingerprintReconciliationContent } from "@/modules/sources/domain/reconciliation-fingerprint";
import { describe, expect, it, vi } from "vitest";
import { normalizeFolderName } from "@/modules/knowledge/domain/tree-rules";
import { parseGenericMarkdownText } from "@/modules/sources/adapters/generic-markdown-folder-adapter";
import { reconcileFolderImport } from "@/modules/sources/domain/import-reconciler";
import { reconcileImportSnapshot } from "@/modules/sources/application/reconcile-import-snapshot";
import type {
  CanonicalAssetState,
  CanonicalDocumentState,
  CanonicalFolderState,
  CanonicalImportState,
  ImportPreviewChange,
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
    uploadKey: `upload:${sourcePath}`,
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

  it("reuses identity across a filename-fallback rename while revising the derived title (§8.2/§10.1 pure unit)", () => {
    const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
    const body = "body\n";
    const before = parseGenericMarkdownText({ sourcePath: "docs/foo.md", text: body, sourceFileHash: sha(body) });
    const after = parseGenericMarkdownText({ sourcePath: "docs/bar.md", text: body, sourceFileHash: sha(body) });
    expect(before.titleSource).toBe("FILENAME");
    expect(after.titleSource).toBe("FILENAME");
    expect(after.reconciliationFingerprint).toBe(before.reconciliationFingerprint);
    expect(after.revisionContentHash).not.toBe(before.revisionContentHash);

    const existing = currentDocument("docs/foo.md", before.reconciliationFingerprint, {
      currentRevision: {
        id: "revision:foo",
        title: before.resolvedTitle,
        markdown: before.markdown,
        metadata: {},
        contentHash: before.revisionContentHash,
      },
    });
    const incoming = incomingDocument("docs/bar.md", after.reconciliationFingerprint, {
      title: after.resolvedTitle,
      markdown: after.markdown,
      metadata: {},
      revisionContentHash: after.revisionContentHash,
    });

    const plan = reconcileFolderImport(
      snapshot([incoming]),
      canonical({ documents: [existing], folders: [currentFolder("docs")] }),
    );

    expect(plan.documents.create).toHaveLength(0);
    expect(plan.documents.move).toEqual([
      expect.objectContaining({ entryId: existing.entryId, fromPath: "docs/foo.md", toPath: "docs/bar.md" }),
    ]);
    expect(plan.documents.revise).toEqual([
      expect.objectContaining({ entryId: existing.entryId, expectedCurrentRevisionId: "revision:foo" }),
    ]);
    expect(plan.preview.find((item) => item.kind === "DOCUMENT")?.labels).toEqual(["RENAMED", "UPDATED"]);
    expect(plan.preview.find((item) => item.kind === "DOCUMENT")?.previousPath).toBe("docs/foo.md");
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

  it("restores an archived folder when its path is required again (§11)", () => {
    const plan = reconcileFolderImport(
      snapshot([incomingDocument("docs/a.md", "same")]),
      canonical({ folders: [currentFolder("docs", "ARCHIVED")] }),
    );

    expect(plan.folders.restore).toEqual([
      { entryId: "folder-entry:docs", treeNodeId: "folder-tree:docs", sourcePath: "docs" },
    ]);
    expect(plan.folders.create).toHaveLength(0);
    expect(plan.folders.archive).toHaveLength(0);
    expect(plan.preview.find((item) => item.kind === "FOLDER" && item.sourcePath === "docs")?.labels).toEqual(["RESTORED"]);
    expect(plan.summary.folders).toMatchObject({ added: 0, archived: 0, restored: 1 });
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

  it("marks a same-path same-hash asset UNCHANGED without an upsert and a changed-hash asset UPDATED (§12)", () => {
    const plan = reconcileFolderImport(
      snapshot([], [incomingAsset("images/logo.png", "hash:new"), incomingAsset("images/same.png", "hash:keep")]),
      canonical({ assets: [currentAsset("images/logo.png", "hash:old"), currentAsset("images/same.png", "hash:keep")] }),
    );

    expect(plan.assets.upsert).toEqual([expect.objectContaining({ sourcePath: "images/logo.png", contentHash: "hash:new" })]);
    expect(plan.assets.remove).toHaveLength(0);
    expect(plan.preview.find((item) => item.kind === "ASSET" && item.sourcePath === "images/logo.png")?.labels).toEqual(["UPDATED"]);
    expect(plan.preview.find((item) => item.kind === "ASSET" && item.sourcePath === "images/same.png")?.labels).toEqual(["UNCHANGED"]);
    expect(plan.summary.assets).toMatchObject({ added: 0, updated: 1, removed: 0, unchanged: 1 });
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

    const plan = reconcileFolderImport(snapshot([incoming]), canonical({ documents: [byExternal, byPath] }));
    expect(plan.preview.find((change) => change.sourcePath === "a.md")?.diagnostics).toContainEqual(
      expect.objectContaining({ code: "IDENTITY_CONFLICT", sourcePath: "a.md", severity: "BLOCKING" }),
    );
  });

  it("rejects duplicate external IDs in one snapshot", () => {
    const left = incomingDocument("a.md", "one", { externalId: "X" });
    const right = incomingDocument("b.md", "two", { externalId: "X" });
    const plan = reconcileFolderImport(snapshot([left, right]), canonical());
    expect(plan.documents.create).toEqual([]);
    expect(plan.summary.blockers).toBe(2);
    expect(plan.preview.every((change) => change.diagnostics.some((diagnostic) => diagnostic.code === "IDENTITY_CONFLICT"))).toBe(true);
  });

  it("adopts an exact-path identity without changing content counters", () => {
    const existing = currentDocument("auth.md", "same");
    const plan = reconcileFolderImport(snapshot([incomingDocument("auth.md", "same", { externalId: "K1" })]), canonical({ documents: [existing] }));
    expect(plan.planVersion).toBe("phase2:v2");
    expect(plan.documents.adoptExternalId).toEqual([{ entryId: existing.entryId, externalId: "K1" }]);
    expect(plan.documents.revise).toHaveLength(0);
    expect(plan.preview[0]).toMatchObject({ labels: ["UNCHANGED"], identity: { adoptedExternalId: "K1" } });
    expect(plan.summary.documents).toMatchObject({ unchanged: 1, updated: 0 });
  });

  it("adopts identity across a unique-fingerprint rename", () => {
    const existing = currentDocument("old.md", "same");
    const plan = reconcileFolderImport(snapshot([incomingDocument("new.md", "same", { externalId: "K1" })]), canonical({ documents: [existing] }));
    expect(plan.documents.adoptExternalId).toEqual([{ entryId: existing.entryId, externalId: "K1" }]);
    expect(plan.documents.move).toEqual([expect.objectContaining({ entryId: existing.entryId, toPath: "new.md" })]);
    expect(plan.documents.revise).toHaveLength(0);
  });

  it("preserves established identity across simultaneous rename and content edit", () => {
    const existing = currentDocument("old.md", "old", { externalId: "K1" });
    const plan = reconcileFolderImport(snapshot([incomingDocument("new.md", "new", { externalId: "K1", markdown: "Edited" })]), canonical({ documents: [existing] }));
    expect(plan.documents.adoptExternalId).toEqual([]);
    expect(plan.documents.move).toHaveLength(1);
    expect(plan.documents.revise).toHaveLength(1);
    expect(plan.documents.create).toHaveLength(0);
  });

  it.each([null, "K2"])("blocks established identity replacement with %s at exact path or fingerprint", (externalId) => {
    for (const sourcePath of ["old.md", "new.md"]) {
      const existing = currentDocument("old.md", "same", { externalId: "K1" });
      const plan = reconcileFolderImport(snapshot([incomingDocument(sourcePath, "same", { externalId })]), canonical({ documents: [existing] }));
      expect(plan.preview.find((change) => change.sourcePath === sourcePath)?.diagnostics).toContainEqual(expect.objectContaining({ code: "IDENTITY_CONFLICT", severity: "BLOCKING", sourcePath }));
      expect(plan.documents.adoptExternalId).toEqual([]);
      expect(plan.documents.create).toEqual([]);
      expect(plan.documents.revise).toEqual([]);
      expect(plan.documents.move).toEqual([]);
    }
  });

  it("blocks ambiguous identified adoption on either side", () => {
    for (const [incoming, existing] of [
      [[incomingDocument("new.md", "same", { externalId: "K1" })], [currentDocument("a.md", "same"), currentDocument("b.md", "same")]],
      [[incomingDocument("new.md", "same", { externalId: "K1" }), incomingDocument("other.md", "same", { externalId: "K2" })], [currentDocument("a.md", "same")]],
    ] as [ReadyImportDocument[], CanonicalDocumentState[]][]) {
      const plan = reconcileFolderImport(snapshot(incoming), canonical({ documents: existing }));
      expect(plan.documents.adoptExternalId).toEqual([]);
      expect(plan.documents.create).toEqual([]);
      expect(plan.summary.blockers).toBe(incoming.length);
      expect(plan.preview.flatMap((change) => change.diagnostics)).toEqual(incoming.map(() => expect.objectContaining({ code: "IDENTITY_ADOPTION_AMBIGUOUS", severity: "BLOCKING" })));
    }
  });

  it("supports new identified and unidentified documents together with case-sensitive IDs", () => {
    const plan = reconcileFolderImport(snapshot([
      incomingDocument("a.md", "a", { externalId: "K1" }),
      incomingDocument("b.md", "b", { externalId: "k1" }),
      incomingDocument("c.md", "c"),
    ]), canonical());
    expect(plan.documents.create.map((action) => action.externalId)).toEqual(["K1", "k1", null]);
    expect(plan.documents.adoptExternalId).toEqual([]);
    expect(plan.summary.blockers).toBe(0);
  });

  it("ignores stored legacy knowledge_id without rewriting history, but retains real metadata changes", () => {
    const existing = currentDocument("auth.md", "same");
    existing.currentRevision.metadata = { knowledge_id: "K1", owner: "platform" };
    const incoming = incomingDocument("auth.md", "same", { externalId: "K1", metadata: { owner: "platform" } });
    const plan = reconcileFolderImport(snapshot([incoming]), canonical({ documents: [existing] }));
    expect(plan.documents.revise).toEqual([]);
    expect(existing.currentRevision.metadata).toEqual({ knowledge_id: "K1", owner: "platform" });
    const edited = reconcileFolderImport(snapshot([{ ...incoming, metadata: { owner: "security" } }]), canonical({ documents: [existing] }));
    expect(edited.documents.revise[0].content.metadata).toEqual({ owner: "security" });
  });

  it("rejects duplicate canonical IDs as a global integrity conflict", () => {
    expect(() => reconcileFolderImport(snapshot(), canonical({ documents: [
      currentDocument("a.md", "a", { externalId: "K1" }),
      currentDocument("b.md", "b", { externalId: "K1" }),
    ] }))).toThrowError(expect.objectContaining({ code: "IDENTITY_CONFLICT" }));
  });

  it("blocks a second file reusing the original path of an externally matched predecessor", () => {
    const plan = reconcileFolderImport(snapshot([
      incomingDocument("new.md", "changed", { externalId: "K1" }),
      incomingDocument("old.md", "other"),
    ]), canonical({ documents: [currentDocument("old.md", "same", { externalId: "K1" })] }));
    expect(plan.preview.find((change) => change.sourcePath === "old.md")?.diagnostics).toContainEqual(expect.objectContaining({ code: "IDENTITY_CONFLICT", severity: "BLOCKING" }));
    expect(plan.documents.create).toEqual([]);
  });

  it("loads legacy fingerprints without reserved metadata while retaining the immutable revision", async () => {
    const query = vi.fn().mockResolvedValueOnce([{
      entry_id: "entry:old.md", external_id: null, source_path: "old.md", entry_type: "DOCUMENT", entry_status: "ACTIVE",
      document_id: "document:old.md", tree_node_id: "tree:old.md", tree_node_type: "DOCUMENT",
      revision_id: "legacy", title: "Stable title", markdown: "Stable body\n",
      metadata: JSON.stringify({ knowledge_id: "K1", owner: "platform" }), content_hash: "legacy-hash",
    }]).mockResolvedValueOnce([]);
    const state = await new MariaDbImportCanonicalStateRepository({ query }).load("source");
    const fingerprint = fingerprintReconciliationContent({ markdown: "Stable body\n", metadata: { owner: "platform" } });
    expect(state.documents[0].reconciliationFingerprint).toBe(fingerprint);
    expect(state.documents[0].currentRevision.metadata).toHaveProperty("knowledge_id", "K1");
    const plan = reconcileFolderImport(snapshot([incomingDocument("new.md", fingerprint, { externalId: "K1", metadata: { owner: "platform" } })]), state);
    expect(plan.documents.adoptExternalId).toEqual([{ entryId: "entry:old.md", externalId: "K1" }]);
    expect(plan.documents.move).toHaveLength(1);
    expect(plan.documents.revise).toHaveLength(0);
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

  it("reconciles 1,000 incoming against 1,000 existing through lookup-map matching", () => {
    const existing: CanonicalDocumentState[] = [];
    const incoming: ReadyImportDocument[] = [];

    for (let index = 0; index < 500; index += 1) {
      const sourcePath = `docs/stable-${String(index).padStart(4, "0")}.md`;
      const fingerprint = `fp-stable-${index}`;
      existing.push(currentDocument(sourcePath, fingerprint));
      incoming.push(incomingDocument(sourcePath, fingerprint));
    }

    for (let index = 500; index < 800; index += 1) {
      const sourcePath = `docs/updated-${String(index).padStart(4, "0")}.md`;
      const fingerprint = `fp-updated-${index}`;
      existing.push(currentDocument(sourcePath, fingerprint));
      incoming.push(
        incomingDocument(sourcePath, fingerprint, {
          title: `Updated title ${index}`,
          markdown: `Updated body ${index}\n`,
          revisionContentHash: `revision:updated-${index}`,
        }),
      );
    }

    for (let index = 800; index < 1000; index += 1) {
      const fingerprint = `fp-moved-${index}`;
      existing.push(currentDocument(`docs/moved-${String(index).padStart(4, "0")}.md`, fingerprint));
      incoming.push(incomingDocument(`guide/moved-${String(index).padStart(4, "0")}.md`, fingerprint));
    }

    const plan = reconcileFolderImport(
      { sourceBinding: binding, documents: incoming, assets: [] },
      { documents: existing, folders: [currentFolder("docs"), currentFolder("guide")], assets: [] },
    );

    expect(plan.summary.documents).toMatchObject({
      unchanged: 500,
      updated: 300,
      moved: 200,
      renamed: 0,
      added: 0,
      archived: 0,
    });
    expect(plan.documents.create).toHaveLength(0);
    expect(plan.documents.archive).toHaveLength(0);
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

  it("does not plan ARCHIVED for a blocked-but-present canonical document", () => {
    const existing = currentDocument("guide.md", "same");
    const blockerChange: ImportPreviewChange = {
      kind: "DOCUMENT",
      sourcePath: "guide.md",
      previousPath: null,
      labels: [],
      diagnostics: [
        {
          code: "INVALID_FRONTMATTER",
          severity: "BLOCKING",
          sourcePath: "guide.md",
          message: "File guide.md has invalid frontmatter.",
        },
      ],
    };
    const plan = reconcileImportSnapshot(
      snapshot(),
      canonical({ documents: [existing] }),
      [blockerChange],
      new Set(["guide.md"]),
    );

    expect(plan.preview.filter((item) => item.sourcePath === "guide.md")).toHaveLength(1);
    expect(plan.preview.find((item) => item.sourcePath === "guide.md")?.labels).toEqual([]);
    expect(plan.documents.archive).toHaveLength(0);
    expect(plan.summary.documents.archived).toBe(0);
    expect(plan.summary.blockers).toBeGreaterThan(0);
  });

  it("does not plan REMOVED for a blocked-but-present canonical asset", () => {
    const existing = currentAsset("images/logo.png", "hash:old");
    const blockerChange: ImportPreviewChange = {
      kind: "ASSET",
      sourcePath: "images/logo.png",
      previousPath: null,
      labels: [],
      diagnostics: [
        {
          code: "INVALID_ASSET",
          severity: "BLOCKING",
          sourcePath: "images/logo.png",
          message: "File images/logo.png failed validation.",
        },
      ],
    };
    const plan = reconcileImportSnapshot(
      snapshot(),
      canonical({ assets: [existing] }),
      [blockerChange],
      new Set(["images/logo.png"]),
    );

    expect(plan.preview.filter((item) => item.sourcePath === "images/logo.png")).toHaveLength(1);
    expect(plan.preview.find((item) => item.sourcePath === "images/logo.png")?.labels).toEqual([]);
    expect(plan.assets.remove).toHaveLength(0);
    expect(plan.summary.assets.removed).toBe(0);
    expect(plan.summary.blockers).toBeGreaterThan(0);
  });

  it("does not plan ARCHIVED for a blocked file sharing its path with a canonical ACTIVE folder", () => {
    const existing = currentFolder("guide");
    const blockerChange: ImportPreviewChange = {
      kind: "DOCUMENT",
      sourcePath: "guide",
      previousPath: null,
      labels: [],
      diagnostics: [
        {
          code: "INVALID_FRONTMATTER",
          severity: "BLOCKING",
          sourcePath: "guide",
          message: "File guide has invalid frontmatter.",
        },
      ],
    };
    const plan = reconcileImportSnapshot(
      snapshot(),
      canonical({ folders: [existing] }),
      [blockerChange],
      new Set(["guide"]),
    );

    expect(plan.preview.filter((item) => item.sourcePath === "guide")).toHaveLength(1);
    expect(plan.preview.find((item) => item.sourcePath === "guide")?.labels).toEqual([]);
    expect(plan.folders.archive).toHaveLength(0);
    expect(plan.summary.folders.archived).toBe(0);
    expect(plan.summary.blockers).toBeGreaterThan(0);
  });

  it("does not restore an archived canonical folder for a blocked file at the same path", () => {
    const archived = currentFolder("guide", "ARCHIVED");
    const blockerChange: ImportPreviewChange = {
      kind: "DOCUMENT",
      sourcePath: "guide",
      previousPath: null,
      labels: [],
      diagnostics: [
        {
          code: "INVALID_FRONTMATTER",
          severity: "BLOCKING",
          sourcePath: "guide",
          message: "File guide has invalid frontmatter.",
        },
      ],
    };
    const plan = reconcileImportSnapshot(
      snapshot(),
      canonical({ folders: [archived] }),
      [blockerChange],
      new Set(["guide"]),
    );

    expect(plan.folders.restore).toHaveLength(0);
    expect(plan.folders.archive).toHaveLength(0);
    expect(plan.summary.folders.restored).toBe(0);
    expect(plan.summary.folders.archived).toBe(0);
    expect(plan.summary.blockers).toBeGreaterThan(0);
  });
});
