import { createHash } from "node:crypto";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { compareImportText } from "@/modules/sources/domain/import-path";
import { importError } from "@/modules/sources/domain/import-errors";
import { DEFAULT_IMPORT_LIMITS, type ImportLimits } from "@/modules/sources/domain/import-limits";
import type { ImportSnapshot, ImportSnapshotEntry } from "@/modules/sources/domain/import-snapshot";
import type { SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";
import { uuidv7 } from "@/shared/ids/uuidv7";

export type ImportManifestEntry =
  | { uploadKey: string; relativePath: string; kind: "MARKDOWN"; size: number }
  | { uploadKey: string; relativePath: string; kind: "ASSET"; size: number; contentHash: string; mimeType: string | null; lastModified: Date | null };

export type CreateImportResult = { snapshotId: string; state: "BUILDING"; expiresAt: Date };

type Options = { limits?: ImportLimits; now?: () => Date; buildingTtlMs?: number };
const MARKDOWN_EXTENSION = /\.(?:md|markdown)$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_ASSET_MIME_CHARS = 255;

function nonemptyName(value: string, field: string): string {
  if (typeof value !== "string") throw importError("INVALID_IMPORT_MANIFEST", `${field} must be a string.`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 512) throw importError("INVALID_IMPORT_MANIFEST", `${field} must be between 1 and 512 characters.`);
  return trimmed;
}

function manifestPathBytes(path: string): number {
  const approximatedNormalized = path.replace(/\\/gu, "/").split("/").filter((part) => part !== "" && part !== ".").join("/");
  return new TextEncoder().encode(approximatedNormalized).byteLength;
}

function canonicalManifestHash(entries: readonly ImportManifestEntry[]): string {
  const canonical = [...entries].map((entry) => {
    const serverKind = MARKDOWN_EXTENSION.test(entry.relativePath) ? "MARKDOWN" : "ASSET";
    const asset = serverKind === "ASSET" ? entry as Partial<Extract<ImportManifestEntry, { kind: "ASSET" }>> : null;
    return {
      uploadKey: entry.uploadKey,
      relativePath: entry.relativePath,
      kind: serverKind,
      size: entry.size,
      contentHash: asset?.contentHash ?? null,
      mimeType: asset?.mimeType ?? null,
      lastModified: asset?.lastModified?.toISOString() ?? null,
    };
  }).sort((a, b) => compareImportText(a.relativePath, b.relativePath) || compareImportText(a.uploadKey, b.uploadKey));
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

function validateManifest(manifest: readonly ImportManifestEntry[], limits: ImportLimits): void {
  if (!Array.isArray(manifest) || manifest.length === 0 || manifest.length > limits.maxManifestEntries) {
    throw importError("IMPORT_LIMIT_EXCEEDED", `Manifest must contain between 1 and ${limits.maxManifestEntries} entries.`);
  }
  const keys = new Set<string>();
  const paths = new Set<string>();
  let markdownBytes = 0;
  for (const raw of manifest) {
    if (!raw || typeof raw.uploadKey !== "string" || !raw.uploadKey || raw.uploadKey.length > 512) {
      throw importError("INVALID_IMPORT_MANIFEST", "Every manifest entry requires a non-empty uploadKey up to 512 characters.");
    }
    if (keys.has(raw.uploadKey)) throw importError("INVALID_IMPORT_MANIFEST", `Duplicate uploadKey: ${raw.uploadKey}`);
    keys.add(raw.uploadKey);
    if (typeof raw.relativePath !== "string" || !raw.relativePath || paths.has(raw.relativePath)) {
      throw importError("INVALID_IMPORT_MANIFEST", "Manifest relative paths must be non-empty and unique.");
    }
    paths.add(raw.relativePath);
    if (manifestPathBytes(raw.relativePath) > limits.maxPathBytes) throw importError("IMPORT_LIMIT_EXCEEDED", "Manifest path exceeds the import path byte limit.");
    if (!Number.isSafeInteger(raw.size) || raw.size < 0) throw importError("INVALID_IMPORT_MANIFEST", "Manifest size must be a non-negative integer.");

    if (MARKDOWN_EXTENSION.test(raw.relativePath)) {
      if (raw.size > limits.maxMarkdownFileBytes) throw importError("IMPORT_LIMIT_EXCEEDED", "Markdown file exceeds the per-file byte limit.");
      markdownBytes += raw.size;
      if (markdownBytes > limits.maxMarkdownTotalBytes) throw importError("IMPORT_LIMIT_EXCEEDED", "Markdown files exceed the total import byte limit.");
      continue;
    }

    const asset = raw as Partial<Extract<ImportManifestEntry, { kind: "ASSET" }>>;
    if (typeof asset.contentHash !== "string" || !SHA256.test(asset.contentHash.toLowerCase())) {
      throw importError("INVALID_ASSET_MANIFEST", "Non-Markdown assets require a SHA-256 content hash.");
    }
    if (asset.mimeType !== null && (typeof asset.mimeType !== "string" || asset.mimeType.length > MAX_ASSET_MIME_CHARS)) {
      throw importError("INVALID_ASSET_MANIFEST", `Asset MIME type must be null or a string up to ${MAX_ASSET_MIME_CHARS} characters.`);
    }
    if (asset.lastModified !== null && (!(asset.lastModified instanceof Date) || Number.isNaN(asset.lastModified.getTime()))) {
      throw importError("INVALID_ASSET_MANIFEST", "Asset lastModified must be a valid Date or null.");
    }
  }
}

function stagingEntries(snapshotId: string, manifest: readonly ImportManifestEntry[]): ImportSnapshotEntry[] {
  return manifest.map((raw) => {
    const markdown = MARKDOWN_EXTENSION.test(raw.relativePath);
    const asset = raw as Partial<Extract<ImportManifestEntry, { kind: "ASSET" }>>;
    return {
      id: uuidv7(), snapshotId, uploadKey: raw.uploadKey, clientRelativePath: raw.relativePath,
      sourcePath: null, sourcePathHash: null, entryType: markdown ? "DOCUMENT" : "ASSET",
      uploadStatus: markdown ? "PENDING" : "RECEIVED", declaredSize: raw.size, sourceFileHash: null,
      rawMarkdown: null, resolvedTitle: null, titleSource: null, markdown: null, metadata: null,
      revisionContentHash: null, reconciliationFingerprint: null,
      mimeType: markdown ? null : (asset.mimeType ?? null),
      assetContentHash: markdown ? null : String(asset.contentHash).toLowerCase(),
      assetSize: markdown ? null : raw.size,
      assetLastModified: markdown ? null : (asset.lastModified ?? null),
      diagnostics: [], previewChange: null,
    };
  });
}

export class CreateFolderImportService {
  private readonly limits: ImportLimits;
  private readonly now: () => Date;
  private readonly buildingTtlMs: number;
  private readonly quotaLockTimeoutSeconds = 10;

  constructor(private readonly uow: SourceUnitOfWork, options: Options = {}) {
    this.limits = options.limits ?? DEFAULT_IMPORT_LIMITS;
    this.now = options.now ?? (() => new Date());
    this.buildingTtlMs = options.buildingTtlMs ?? 2 * 60 * 60 * 1000;
  }

  private async assertQuota(repositories: Parameters<Parameters<SourceUnitOfWork["run"]>[0]>[0], caller: CallerContext, now: Date): Promise<void> {
    const building = await repositories.importSnapshots.countActiveByCreatorAndState(caller.identity.id, "BUILDING", now);
    if (building >= this.limits.maxBuildingSnapshotsPerUser) throw importError("IMPORT_BUILDING_QUOTA_EXCEEDED", "Too many active BUILDING import snapshots.");
    const ready = await repositories.importSnapshots.countActiveByCreatorAndState(caller.identity.id, "READY", now);
    if (ready >= this.limits.maxReadySnapshotsPerUser) throw importError("IMPORT_READY_QUOTA_EXCEEDED", "Too many active READY import snapshots.");
  }

  private async createBound(caller: CallerContext, input: {
    workspaceId: string; sourceId: string | null; basedOnVersion: number | null; proposedSourceName: string | null;
    rootName: string; manifest: ImportManifestEntry[];
  }): Promise<CreateImportResult> {
    validateManifest(input.manifest, this.limits);
    const rootName = nonemptyName(input.rootName, "rootName");
    const proposedSourceName = input.proposedSourceName === null ? null : nonemptyName(input.proposedSourceName, "sourceName");
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.buildingTtlMs);
    const snapshotId = uuidv7();
    const snapshot: ImportSnapshot = {
      id: snapshotId, workspaceId: input.workspaceId, sourceId: input.sourceId, basedOnVersion: input.basedOnVersion,
      createdBy: caller.identity.id, rootName, proposedSourceName, adapterType: "GENERIC_MARKDOWN_FOLDER",
      adapterVersion: "phase2:v1", planVersion: "phase2:v1", state: "BUILDING",
      manifestHash: canonicalManifestHash(input.manifest), snapshotHash: null, planHash: null, hasBlockers: false,
      summary: null, plan: null, createdAt: now, finalizedAt: null, expiresAt, appliedAt: null, staleAt: null,
      resultSourceId: null, resultVersion: null,
    };
    await this.uow.runWithCreatorQuotaLock(caller.identity.id, this.quotaLockTimeoutSeconds, async (repositories) => {
      await repositories.workspaceAccess.requireMembership(caller, input.workspaceId);
      await this.assertQuota(repositories, caller, now);
      await repositories.importSnapshots.insert(snapshot);
      await repositories.importSnapshotEntries.insertMany(stagingEntries(snapshotId, input.manifest));
    });
    return { snapshotId, state: "BUILDING", expiresAt };
  }

  async createInitial(caller: CallerContext, input: { workspaceId: string; sourceName: string; rootName: string; manifest: ImportManifestEntry[] }): Promise<CreateImportResult> {
    return this.createBound(caller, {
      workspaceId: input.workspaceId, sourceId: null, basedOnVersion: null,
      proposedSourceName: input.sourceName, rootName: input.rootName, manifest: input.manifest,
    });
  }

  async createResync(caller: CallerContext, input: { sourceId: string; rootName: string; manifest: ImportManifestEntry[] }): Promise<CreateImportResult> {
    validateManifest(input.manifest, this.limits);
    const binding = await this.uow.run(async (repositories) => {
      const source = await repositories.sources.findById(input.sourceId);
      if (!source) throw importError("IMPORT_SOURCE_NOT_FOUND", "Import source was not found.");
      await repositories.workspaceAccess.requireMembership(caller, source.workspaceId);
      if (source.status !== "ACTIVE" || source.sourceType !== "FOLDER_SYNC" || source.ownership !== "SOURCE_MANAGED") {
        throw importError("SOURCE_IMPORT_NOT_ALLOWED", "Only active SOURCE_MANAGED folder sources can be resynced.");
      }
      return { workspaceId: source.workspaceId, basedOnVersion: source.syncVersion };
    });
    return this.createBound(caller, {
      workspaceId: binding.workspaceId, sourceId: input.sourceId, basedOnVersion: binding.basedOnVersion,
      proposedSourceName: null, rootName: input.rootName, manifest: input.manifest,
    });
  }
}
