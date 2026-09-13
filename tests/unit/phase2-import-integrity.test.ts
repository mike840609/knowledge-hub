import { describe, expect, it } from "vitest";
import { hashReadyImportSnapshot } from "@/modules/sources/domain/import-integrity";
import type { ImportSnapshot, ImportSnapshotEntry } from "@/modules/sources/domain/import-snapshot";

type HashableSnapshot = Parameters<typeof hashReadyImportSnapshot>[0];

const snapshotHeader: Pick<
  ImportSnapshot,
  "adapterType" | "adapterVersion" | "planVersion" | "workspaceId" | "sourceId" | "basedOnVersion"
> = {
  adapterType: "GENERIC_MARKDOWN_FOLDER",
  adapterVersion: "phase2:v1",
  planVersion: "phase2:v1",
  workspaceId: "0199f500-0000-7000-8000-000000000001",
  sourceId: "0199f500-0000-7000-8000-000000000002",
  basedOnVersion: 7,
};

function documentEntry(sourcePath: string, input: Partial<ImportSnapshotEntry> = {}): ImportSnapshotEntry {
  return {
    id: `id:${sourcePath}`,
    snapshotId: "0199f500-0000-7000-8000-000000000003",
    uploadKey: `0-${sourcePath}`,
    clientRelativePath: sourcePath,
    sourcePath,
    sourcePathHash: `path:${sourcePath}`,
    entryType: "DOCUMENT",
    uploadStatus: "RECEIVED",
    declaredSize: 12,
    sourceFileHash: `file:${sourcePath}`,
    rawMarkdown: null,
    resolvedTitle: "Title",
    titleSource: "H1",
    markdown: `# Title\n\nBody of ${sourcePath}\n`,
    metadata: {},
    revisionContentHash: `revision:${sourcePath}`,
    reconciliationFingerprint: `fingerprint:${sourcePath}`,
    mimeType: null,
    assetContentHash: null,
    assetSize: null,
    assetLastModified: null,
    diagnostics: [],
    previewChange: null,
    ...input,
  };
}

/**
 * Entries whose `clientRelativePath` cannot be normalized keep `sourcePath`
 * null and carry the rejected client path inside their blocking diagnostic.
 */
function unnormalizableEntry(clientRelativePath: string): ImportSnapshotEntry {
  return documentEntry(clientRelativePath, {
    id: `id:${clientRelativePath}`,
    uploadKey: `0-${clientRelativePath}`,
    clientRelativePath,
    sourcePath: null,
    sourcePathHash: null,
    sourceFileHash: `file:${clientRelativePath}`,
    resolvedTitle: null,
    titleSource: null,
    markdown: null,
    metadata: null,
    revisionContentHash: null,
    reconciliationFingerprint: null,
    diagnostics: [
      {
        code: "INVALID_SOURCE_PATH",
        severity: "BLOCKING",
        sourcePath: clientRelativePath,
        message: "Source paths must be safe relative paths.",
      },
    ],
  });
}

function hash(entries: readonly ImportSnapshotEntry[], header: HashableSnapshot = snapshotHeader): string {
  return hashReadyImportSnapshot(header, entries);
}

describe("Phase 2 READY snapshot hash", () => {
  it("ignores browser upload order and client upload bookkeeping", () => {
    const asUploaded = [
      documentEntry("docs/b.md", { uploadKey: "0-b.md" }),
      documentEntry("docs/a.md", { uploadKey: "1-a.md" }),
      documentEntry("images/logo.png", {
        uploadKey: "2-logo.png",
        entryType: "ASSET",
        mimeType: "image/png",
        assetContentHash: "asset:logo",
        assetSize: 40,
        assetLastModified: new Date("2026-09-13T06:00:00.000Z"),
        markdown: null,
        metadata: null,
        resolvedTitle: null,
        titleSource: null,
        revisionContentHash: null,
        reconciliationFingerprint: null,
      }),
    ];

    // Same logical folder, a client that walked the tree in another order and
    // therefore produced other index-derived upload keys.
    const reuploaded = [
      { ...asUploaded[2], uploadKey: "0-logo.png", id: "other:logo" },
      { ...asUploaded[1], uploadKey: "1-a.md", id: "other:a" },
      { ...asUploaded[0], uploadKey: "2-b.md", id: "other:b" },
    ];

    expect(hash(reuploaded)).toBe(hash(asUploaded));
  });

  it("ignores clientRelativePath spelling once a path has been normalized", () => {
    const normalized = documentEntry("docs/a.md");
    const windowsClient = documentEntry("docs/a.md", { clientRelativePath: "wiki\\docs\\a.md" });

    expect(hash([windowsClient])).toBe(hash([normalized]));
  });

  it("changes when the normalized source path changes", () => {
    expect(hash([documentEntry("docs/a.md")])).not.toBe(hash([documentEntry("docs/renamed.md")]));
  });

  it("changes when adapter type, adapter version or plan version changes", () => {
    const entries = [documentEntry("docs/a.md")];
    const baseline = hash(entries);

    expect(hash(entries, { ...snapshotHeader, adapterType: "OTHER_ADAPTER" as ImportSnapshot["adapterType"] })).not.toBe(baseline);
    expect(hash(entries, { ...snapshotHeader, adapterVersion: "phase3:v1" as ImportSnapshot["adapterVersion"] })).not.toBe(baseline);
    expect(hash(entries, { ...snapshotHeader, planVersion: "phase3:v1" as ImportSnapshot["planVersion"] })).not.toBe(baseline);
  });

  it("changes when the target binding changes", () => {
    const entries = [documentEntry("docs/a.md")];
    expect(hash(entries, { ...snapshotHeader, basedOnVersion: 8 })).not.toBe(hash(entries));
    expect(hash(entries, { ...snapshotHeader, sourceId: null })).not.toBe(hash(entries));
  });

  it("orders entries without a normalized source path deterministically", () => {
    const left = unnormalizableEntry("../escape.md");
    const right = unnormalizableEntry("/absolute.md");

    expect(hash([right, left])).toBe(hash([left, right]));
    expect(hash([left, right])).not.toBe(hash([left, left]));
    expect(hash([left, right])).not.toBe(hash([left]));
  });

  it("orders colliding entries that share one normalized source path deterministically", () => {
    const left = documentEntry("docs/a.md", { id: "id:left", sourcePathHash: null, markdown: "left\n", sourceFileHash: "file:left" });
    const right = documentEntry("docs/a.md", { id: "id:right", sourcePathHash: null, markdown: "right\n", sourceFileHash: "file:right" });

    expect(hash([right, left])).toBe(hash([left, right]));
    expect(hash([left, right])).not.toBe(hash([left, left]));
  });

  it("changes when canonical entry content that Apply depends on changes", () => {
    const baseline = hash([documentEntry("docs/a.md")]);

    expect(hash([documentEntry("docs/a.md", { markdown: "# Title\n\nTampered\n" })])).not.toBe(baseline);
    expect(hash([documentEntry("docs/a.md", { resolvedTitle: "Other" })])).not.toBe(baseline);
    expect(hash([documentEntry("docs/a.md", { metadata: { tags: ["x"] } })])).not.toBe(baseline);
    expect(hash([documentEntry("docs/a.md", { revisionContentHash: "revision:other" })])).not.toBe(baseline);
    expect(hash([documentEntry("docs/a.md", { reconciliationFingerprint: "fingerprint:other" })])).not.toBe(baseline);
    expect(hash([documentEntry("docs/a.md", { sourceFileHash: "file:other" })])).not.toBe(baseline);
  });
});
