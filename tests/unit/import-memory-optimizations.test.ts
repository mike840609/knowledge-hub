import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalizeJsonObject } from "@/modules/knowledge/domain/content";
import { ApplyFolderImportService } from "@/modules/sources/application/apply-folder-import";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { hashImportPlan, hashReadyImportSnapshot } from "@/modules/sources/domain/import-integrity";
import { DEFAULT_IMPORT_LIMITS } from "@/modules/sources/domain/import-limits";
import { compareImportText } from "@/modules/sources/domain/import-path";
import type { FolderImportPlan, ImportDiffSummary } from "@/modules/sources/domain/import-plan";
import type { FinalizedImportSnapshotEntry, ImportSnapshot, ImportSnapshotEntry } from "@/modules/sources/domain/import-snapshot";
import type { SourceRepositories, SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";
import { fixtureCaller, fixtureIdentity } from "../fixtures/knowledge";

/**
 * Apply's pre-transaction link extraction is a pure optimisation over the persisted
 * Markdown, so recording every body it parses is the only way to observe that the
 * pre-pass is scoped to the plan's referenced upload keys.
 */
const linkParsing = vi.hoisted(() => ({ parsed: [] as string[] }));
vi.mock("@/modules/knowledge/domain/document-links", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/knowledge/domain/document-links")>();
  return {
    ...actual,
    extractDocumentLinks: (markdown: string) => {
      linkParsing.parsed.push(markdown);
      return actual.extractDocumentLinks(markdown);
    },
  };
});

beforeEach(() => {
  linkParsing.parsed.length = 0;
});

type HashableSnapshot = Parameters<typeof hashReadyImportSnapshot>[0];

const snapshotHeader: Pick<
  ImportSnapshot,
  "adapterType" | "adapterVersion" | "planVersion" | "workspaceId" | "sourceId" | "basedOnVersion"
> = {
  adapterType: "GENERIC_MARKDOWN_FOLDER",
  adapterVersion: "phase2:v2",
  planVersion: "phase2:v2",
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
    externalId: null,
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

// --- Reference implementation: the pre-optimisation shape of the digest input. ---

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalJsonValue(value: unknown): unknown {
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (typeof item !== "undefined") result[key] = canonicalJsonValue(item);
    }
    return result;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value));
}

function referenceEntryPayload(entry: ImportSnapshotEntry): unknown {
  return {
    sourcePath: entry.sourcePath,
    externalId: entry.externalId,
    sourcePathHash: entry.sourcePathHash,
    entryType: entry.entryType,
    sourceFileHash: entry.sourceFileHash,
    resolvedTitle: entry.resolvedTitle,
    titleSource: entry.titleSource,
    markdown: entry.markdown,
    metadata: entry.metadata === null ? null : canonicalizeJsonObject(entry.metadata as Record<string, unknown>),
    revisionContentHash: entry.revisionContentHash,
    reconciliationFingerprint: entry.reconciliationFingerprint,
    mimeType: entry.mimeType,
    assetContentHash: entry.assetContentHash,
    assetSize: entry.assetSize,
    assetLastModified: entry.assetLastModified?.toISOString() ?? null,
    diagnostics: entry.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      details: diagnostic.details === undefined ? undefined : canonicalizeJsonObject(diagnostic.details),
      message: diagnostic.message,
      severity: diagnostic.severity,
      sourcePath: diagnostic.sourcePath,
    })),
  };
}

function referenceHash(
  snapshot: Pick<ImportSnapshot, "adapterType" | "adapterVersion" | "planVersion" | "workspaceId" | "sourceId" | "basedOnVersion" | "importScope">,
  entries: readonly ImportSnapshotEntry[],
): string {
  const ordered = entries
    .map((entry) => ({ sourcePath: entry.sourcePath, serialized: stableStringify(referenceEntryPayload(entry)) }))
    .sort((left, right) => {
      if (left.sourcePath !== right.sourcePath) {
        if (left.sourcePath === null) return 1;
        if (right.sourcePath === null) return -1;
        return compareImportText(left.sourcePath, right.sourcePath);
      }
      return compareImportText(left.serialized, right.serialized);
    });
  return createHash("sha256")
    .update(
      stableStringify({
        adapterType: snapshot.adapterType,
        adapterVersion: snapshot.adapterVersion,
        planVersion: snapshot.planVersion,
        sourceBinding: {
          workspaceId: snapshot.workspaceId,
          sourceId: snapshot.sourceId,
          basedOnVersion: snapshot.basedOnVersion,
        },
        ...(snapshot.importScope === undefined ? {} : { importScope: snapshot.importScope }),
        entries: ordered.map((entry) => entry.serialized),
      }),
      "utf8",
    )
    .digest("hex");
}

describe("streaming READY snapshot hash", () => {
  const colliding: ImportSnapshotEntry[] = [
    documentEntry("docs/collision.md", { id: "id:left", sourcePathHash: null, markdown: "left\n", sourceFileHash: "file:left" }),
    documentEntry("docs/collision.md", { id: "id:right", sourcePathHash: null, markdown: "right\n", sourceFileHash: "file:right" }),
  ];

  it("matches sha256(stableStringify(...)) for unique, colliding and null source paths", () => {
    const entries = [
      documentEntry("docs/b.md"),
      unnormalizableEntry("../escape.md"),
      ...colliding,
      documentEntry("notes/a.md"),
      unnormalizableEntry("/absolute.md"),
      documentEntry("docs/quotes.md", { markdown: "# T\n\n\"quoted\" \\ slash\n\u{1F600}\n", resolvedTitle: "T" }),
    ];
    expect(hashReadyImportSnapshot(snapshotHeader, entries)).toBe(referenceHash(snapshotHeader, entries));
  });

  it("matches the reference digest when an import scope is present", () => {
    const header: HashableSnapshot = {
      ...snapshotHeader,
      importScope: { paths: ["docs"], previousPaths: ["notes"], excludedCount: 2 },
    };
    const entries = [documentEntry("docs/a.md"), documentEntry("docs/a.md", { id: "id:other", sourcePathHash: null, markdown: "other\n", sourceFileHash: "file:other" }), unnormalizableEntry("../x.md")];

    expect(hashReadyImportSnapshot(header, entries)).toBe(referenceHash(header, entries));
  });
});

// --- Finalize: release staged raw Markdown as soon as it has been parsed. ---

function readySnapshotFrom(plan: FolderImportPlan, entries: readonly ImportSnapshotEntry[], id = "0199f500-0000-7000-8000-000000000010"): ImportSnapshot {
  const snapshot: ImportSnapshot = {
    id,
    workspaceId: "0199f500-0000-7000-8000-000000000001",
    sourceId: "0199f500-0000-7000-8000-000000000002",
    basedOnVersion: 1,
    createdBy: fixtureIdentity.id,
    rootName: "wiki",
    proposedSourceName: null,
    adapterType: "GENERIC_MARKDOWN_FOLDER",
    adapterVersion: "phase2:v2",
    planVersion: "phase2:v2",
    state: "READY",
    manifestHash: "manifest",
    snapshotHash: null,
    planHash: null,
    hasBlockers: false,
    summary: plan.summary,
    plan,
    createdAt: new Date("2026-09-13T06:00:00.000Z"),
    finalizedAt: new Date("2026-09-13T06:00:00.000Z"),
    expiresAt: new Date("2030-09-13T06:00:00.000Z"),
    appliedAt: null,
    staleAt: null,
    resultSourceId: null,
    resultVersion: null,
  };
  snapshot.planHash = hashImportPlan(plan);
  snapshot.snapshotHash = hashReadyImportSnapshot(snapshot, entries);
  return snapshot;
}

describe("FinalizeFolderImportService staged rawMarkdown release", () => {
  it("nulls rawMarkdown on kept and ignored staged entries once prepare has parsed them", async () => {
    const staged = [
      documentEntry("docs/a.md", { uploadKey: "k0", rawMarkdown: "# A\n\nBody\n", markdown: null }),
      documentEntry(".hidden/skip.md", { uploadKey: "k1", rawMarkdown: "# Hidden\n", markdown: null, sourceFileHash: "file:hidden" }),
    ];
    const building: ImportSnapshot = {
      ...readySnapshotFrom({
        planVersion: "phase2:v2",
        sourceBinding: { workspaceId: "0199f500-0000-7000-8000-000000000001", sourceId: null, basedOnVersion: null },
        folders: { create: [], restore: [], archive: [] },
        documents: { create: [], restore: [], move: [], revise: [], archive: [], adoptExternalId: [], updateLocator: [] },
        assets: { upsert: [], remove: [] },
        ordering: [],
        preview: [],
        summary: emptySummary(),
      }, staged),
      sourceId: null,
      basedOnVersion: null,
      proposedSourceName: "Wiki",
      state: "BUILDING",
      snapshotHash: null,
      planHash: null,
      summary: null,
      plan: null,
    };

    const replaced: FinalizedImportSnapshotEntry[][] = [];
    const repositories = {
      importSnapshots: {
        lockById: async () => building,
        countActiveByCreatorAndState: async () => 0,
        markReady: async () => undefined,
      },
      importSnapshotEntries: {
        listBySnapshotId: async () => staged,
        replaceFinalizedEntries: async (_snapshotId: string, entries: FinalizedImportSnapshotEntry[]) => {
          replaced.push(entries);
        },
      },
      sources: { lockById: async () => null, findById: async () => null },
      workspaces: {
        lockSharedById: async () => ({ id: building.workspaceId, name: "Fixture Workspace", workspaceType: "TEAM", lifecycleState: "ACTIVE" }),
        findById: async () => ({ name: "Fixture Workspace" }),
      },
      workspaceAccess: { requireMembership: async () => undefined },
      workspaceMemberships: { find: async () => ({ workspaceId: building.workspaceId, userId: fixtureIdentity.id, role: "OWNER" }) },
      groupMappings: { listByWorkspace: async () => [] },
    } as unknown as SourceRepositories;
    const uow: SourceUnitOfWork = {
      async run<T>(work: (repositories: SourceRepositories) => Promise<T>): Promise<T> {
        return work(repositories);
      },
      async read<T>(work: (repositories: SourceRepositories) => Promise<T>): Promise<T> {
        return work(repositories);
      },
      async runWithCreatorQuotaLock<T>(_creatorId: string, _timeoutSeconds: number, work: (repositories: SourceRepositories) => Promise<T>): Promise<T> {
        return work(repositories);
      },
    };

    await new FinalizeFolderImportService(uow, { limits: DEFAULT_IMPORT_LIMITS }).finalize(fixtureCaller(), building.id);

    expect(staged.map((entry) => entry.rawMarkdown)).toEqual([null, null]);
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toHaveLength(1);
    expect(replaced[0][0].markdown).toContain("Body");
  });
});

function emptySummary(): ImportDiffSummary {
  return {
    documents: { added: 0, updated: 0, moved: 0, renamed: 0, archived: 0, restored: 0, unchanged: 0 },
    folders: { added: 0, archived: 0, restored: 0 },
    assets: { added: 0, updated: 0, removed: 0, unchanged: 0 },
    warnings: 0,
    blockers: 0,
    affectedDocuments: 0,
    changed: false,
  };
}

// --- Apply: pre-extract links only for the upload keys the plan references. ---

function emptyPlan(): FolderImportPlan {
  return {
    planVersion: "phase2:v2",
    sourceBinding: { workspaceId: "0199f500-0000-7000-8000-000000000001", sourceId: "0199f500-0000-7000-8000-000000000002", basedOnVersion: 1 },
    folders: { create: [], restore: [], archive: [] },
    documents: { create: [], restore: [], move: [], revise: [], archive: [], adoptExternalId: [], updateLocator: [] },
    assets: { upsert: [], remove: [] },
    ordering: [],
    preview: [],
    summary: emptySummary(),
  };
}

function applyUow(snapshot: ImportSnapshot, entries: ImportSnapshotEntry[], listCalls: { count: number }): SourceUnitOfWork {
  const repositories = {
    importSnapshots: {
      findById: async () => snapshot,
      lockById: async () => snapshot,
    },
    importSnapshotEntries: {
      listBySnapshotId: async () => {
        listCalls.count += 1;
        return entries.map((entry) => Object.freeze({ ...entry }));
      },
    },
    sources: { lockById: async () => null, findById: async () => null },
    workspaceAccess: { requireMembership: async () => undefined },
    workspaceMemberships: { find: async () => null },
    groupMappings: { listByWorkspace: async () => [] },
    workspaces: { lockSharedById: async () => null, findById: async () => null },
  } as unknown as SourceRepositories;
  return {
    async run<T>(work: (repositories: SourceRepositories) => Promise<T>): Promise<T> {
      return work(repositories);
    },
    async read<T>(work: (repositories: SourceRepositories) => Promise<T>): Promise<T> {
      return work(repositories);
    },
    async runWithCreatorQuotaLock<T>(_creatorId: string, _timeoutSeconds: number, work: (repositories: SourceRepositories) => Promise<T>): Promise<T> {
      return work(repositories);
    },
  };
}

function applyService(snapshot: ImportSnapshot, entries: ImportSnapshotEntry[], listCalls: { count: number }): ApplyFolderImportService {
  return new ApplyFolderImportService(applyUow(snapshot, entries, listCalls), { now: () => new Date("2026-09-13T10:05:00.000Z") });
}

describe("ApplyFolderImportService plan-scoped link pre-extraction", () => {
  it("skips staged entry reads before locking when the plan creates or revises no documents", async () => {
    const entries = [
      documentEntry("docs/a.md", { uploadKey: "k0" }),
      documentEntry("docs/b.md", { uploadKey: "k1" }),
    ];
    const plan = emptyPlan();
    plan.documents.move.push({ entryId: "entry-a", treeNodeId: "node-a", fromPath: "docs/a.md", toPath: "docs/moved-a.md", parentPath: null, desiredPosition: 0 });
    const snapshot = readySnapshotFrom(plan, entries);
    const listCalls = { count: 0 };

    const rejection = applyService(snapshot, entries, listCalls).apply(fixtureCaller(), snapshot.id);

    await expect(rejection).rejects.toMatchObject({ code: "IMPORT_SOURCE_NOT_FOUND" });
    // Only Apply's own integrity-verification read inside the transaction remains.
    expect(listCalls.count).toBe(1);
    expect(linkParsing.parsed).toEqual([]);
  });

  it("parses links only for the one document the plan creates, not every staged entry", async () => {
    const entries = [
      documentEntry("docs/a.md", { uploadKey: "k0" }),
      documentEntry("docs/b.md", { uploadKey: "k1" }),
      documentEntry("docs/c.md", { uploadKey: "k2" }),
    ];
    const plan = emptyPlan();
    plan.documents.create.push({
      sourcePath: "docs/a.md",
      parentPath: null,
      desiredPosition: 0,
      externalId: null,
      content: { uploadKey: "k0", title: "A", metadata: {}, contentHash: "hash-a" },
    });
    const snapshot = readySnapshotFrom(plan, entries);
    const listCalls = { count: 0 };

    const rejection = applyService(snapshot, entries, listCalls).apply(fixtureCaller(), snapshot.id);

    await expect(rejection).rejects.toMatchObject({ code: "IMPORT_SOURCE_NOT_FOUND" });
    expect(linkParsing.parsed).toEqual([entries[0].markdown]);
  });

  it("parses links for the upload key of a revise action only", async () => {
    const entries = [
      documentEntry("docs/a.md", { uploadKey: "k0" }),
      documentEntry("docs/b.md", { uploadKey: "k1" }),
      documentEntry("docs/c.md", { uploadKey: "k2" }),
    ];
    const plan = emptyPlan();
    plan.documents.revise.push({
      entryId: "entry-b",
      documentId: "document-b",
      expectedCurrentRevisionId: "revision-b",
      content: { uploadKey: "k1", title: "B", metadata: {}, contentHash: "hash-b" },
    });
    const snapshot = readySnapshotFrom(plan, entries);
    const listCalls = { count: 0 };

    const rejection = applyService(snapshot, entries, listCalls).apply(fixtureCaller(), snapshot.id);

    await expect(rejection).rejects.toMatchObject({ code: "IMPORT_SOURCE_NOT_FOUND" });
    expect(linkParsing.parsed).toEqual([entries[1].markdown]);
  });

  it("parses inline legacy content.markdown even when no staged entry is referenced", async () => {
    const entries = [documentEntry("docs/a.md", { uploadKey: "k0" }), documentEntry("docs/b.md", { uploadKey: "k1" })];
    const inlineMarkdown = "# Legacy\n\nSee [[Target]].\n";
    const plan = emptyPlan();
    plan.documents.create.push({
      sourcePath: "docs/legacy.md",
      parentPath: null,
      desiredPosition: 0,
      externalId: null,
      content: { title: "Legacy", markdown: inlineMarkdown, metadata: {}, contentHash: "hash-legacy" },
    });
    const snapshot = readySnapshotFrom(plan, entries);
    const listCalls = { count: 0 };

    const rejection = applyService(snapshot, entries, listCalls).apply(fixtureCaller(), snapshot.id);

    await expect(rejection).rejects.toMatchObject({ code: "IMPORT_SOURCE_NOT_FOUND" });
    expect(linkParsing.parsed).toEqual([inlineMarkdown]);
    // No upload keys were referenced, so the pre-pass never read staged entries.
    expect(listCalls.count).toBe(1);
  });
});
