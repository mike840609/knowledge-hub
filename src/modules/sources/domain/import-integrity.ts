import { createHash } from "node:crypto";
import { canonicalizeJsonObject } from "@/modules/knowledge/domain/content";
import type { ImportDiagnostic } from "./import-diagnostic";
import type { FolderImportPlan } from "./import-plan";
import { compareImportText } from "./import-path";
import type { ImportSnapshot, ImportSnapshotEntry } from "./import-snapshot";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * MySQL 5.7+ binary JSON reorders object keys on round-trip, so bare
 * `JSON.stringify` of a persisted plan/snapshot/entries disagrees with the
 * in-memory value hashed at finalize time (false integrity mismatch on every
 * finalize-to-apply). Sort object keys recursively before serializing so both
 * sides hash the same bytes regardless of storage key order.
 */
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

/**
 * Frontmatter metadata arrives with arbitrary author key order and MySQL
 * reorders it again on round-trip. Normalize through the shared canonicalizer
 * (also used by the reconciler for asset metadata comparison) so key order
 * never affects the digest.
 */
function canonicalMetadata(metadata: Record<string, unknown> | null): unknown {
  if (metadata === null) return null;
  return canonicalizeJsonObject(metadata);
}

function canonicalDiagnostics(diagnostics: readonly ImportDiagnostic[]): unknown {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    details: diagnostic.details === undefined ? undefined : canonicalizeJsonObject(diagnostic.details),
    message: diagnostic.message,
    severity: diagnostic.severity,
    sourcePath: diagnostic.sourcePath,
  }));
}

/**
 * Canonical digest input for one staging entry (design §15.1).
 *
 * `uploadKey` and `clientRelativePath` are deliberately absent. Both are client
 * transport bookkeeping: the browser launcher derives `uploadKey` from the
 * upload index (`${index}-${file.name}`), so any other client — or a direct API
 * caller — would produce a different digest for byte-identical folder content,
 * and §15.1 requires that browser upload order not affect the hash. The
 * normalized `sourcePath` is the server-derived identity of an entry, and for
 * entries that have none the rejected client path survives inside the hashed
 * blocking diagnostic (`normalizeEntries` in `finalize-folder-import.ts`).
 */
function hashableEntry(entry: ImportSnapshotEntry): unknown {
  return {
    sourcePath: entry.sourcePath,
    externalId: entry.externalId,
    sourcePathHash: entry.sourcePathHash,
    entryType: entry.entryType,
    sourceFileHash: entry.sourceFileHash,
    resolvedTitle: entry.resolvedTitle,
    titleSource: entry.titleSource,
    markdown: entry.markdown,
    metadata: canonicalMetadata(entry.metadata as Record<string, unknown> | null),
    revisionContentHash: entry.revisionContentHash,
    reconciliationFingerprint: entry.reconciliationFingerprint,
    mimeType: entry.mimeType,
    assetContentHash: entry.assetContentHash,
    assetSize: entry.assetSize,
    assetLastModified: entry.assetLastModified?.toISOString() ?? null,
    diagnostics: canonicalDiagnostics(entry.diagnostics),
  };
}

function canonicalPlanContent(content: { metadata: Record<string, unknown> } & Record<string, unknown>): unknown {
  const { metadata, ...rest } = content;
  return { ...(canonicalJsonValue(rest) as Record<string, unknown>), metadata: canonicalizeJsonObject(metadata) };
}

function canonicalPlan(plan: FolderImportPlan): unknown {
  return {
    planVersion: plan.planVersion,
    sourceBinding: { ...plan.sourceBinding },
    folders: {
      create: plan.folders.create.map((item) => ({ ...item })),
      restore: plan.folders.restore.map((item) => ({ ...item })),
      archive: plan.folders.archive.map((item) => ({ ...item })),
    },
    documents: {
      create: plan.documents.create.map((item) => ({ ...item, content: canonicalPlanContent(item.content) })),
      restore: plan.documents.restore.map((item) => ({ ...item })),
      move: plan.documents.move.map((item) => ({ ...item })),
      revise: plan.documents.revise.map((item) => ({ ...item, content: canonicalPlanContent(item.content) })),
      archive: plan.documents.archive.map((item) => ({ ...item })),
      adoptExternalId: plan.documents.adoptExternalId.map((item) => ({ ...item })),
      updateLocator: plan.documents.updateLocator.map((item) => ({ ...item })),
    },
    assets: {
      upsert: plan.assets.upsert.map((item) => ({ ...item, metadata: canonicalizeJsonObject(item.metadata) })),
      remove: plan.assets.remove.map((item) => ({ ...item })),
    },
    ordering: plan.ordering.map((item) => ({ ...item })),
    preview: plan.preview.map((change) => ({ ...change, diagnostics: canonicalDiagnostics(change.diagnostics) })),
    summary: { ...plan.summary },
  };
}

export function hashImportPlan(plan: FolderImportPlan): string {
  return sha256(stableStringify(canonicalPlan(plan)));
}

/**
 * Deterministic total order over digest inputs (design §15.1).
 *
 * The primary key is the normalized `sourcePath`, which is server-derived and
 * therefore independent of upload order. It is not unique on its own: entries
 * whose client path could not be normalized keep `sourcePath` null, and entries
 * that collide on one normalized path keep that shared path. Those ties are
 * broken by each entry's own canonical digest payload, so the order depends
 * only on hashed content — two entries that tie on both keys are byte-identical
 * in the digest and their relative order cannot change the result.
 */
function compareDigestOrder(left: DigestInput, right: DigestInput): number {
  if (left.sourcePath !== right.sourcePath) {
    if (left.sourcePath === null) return 1;
    if (right.sourcePath === null) return -1;
    return compareImportText(left.sourcePath, right.sourcePath);
  }
  return compareImportText(left.serialized, right.serialized);
}

type DigestInput = { sourcePath: string | null; serialized: string };

export function hashReadyImportSnapshot(
  snapshot: Pick<ImportSnapshot, "adapterType" | "adapterVersion" | "planVersion" | "workspaceId" | "sourceId" | "basedOnVersion">,
  entries: readonly ImportSnapshotEntry[],
): string {
  const orderedEntries = entries
    .map((entry): DigestInput => ({ sourcePath: entry.sourcePath, serialized: stableStringify(hashableEntry(entry)) }))
    .sort(compareDigestOrder);
  return sha256(stableStringify({
    adapterType: snapshot.adapterType,
    adapterVersion: snapshot.adapterVersion,
    planVersion: snapshot.planVersion,
    sourceBinding: {
      workspaceId: snapshot.workspaceId,
      sourceId: snapshot.sourceId,
      basedOnVersion: snapshot.basedOnVersion,
    },
    entries: orderedEntries.map((entry) => entry.serialized),
  }));
}
