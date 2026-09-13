import { createHash } from "node:crypto";
import type { FolderImportPlan } from "./import-plan";
import { compareImportText } from "./import-path";
import type { ImportSnapshot, ImportSnapshotEntry } from "./import-snapshot";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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
    // §15.1 enumerates external IDs. Phase 2's generic Markdown adapter never
    // produces one and staging has no column for it, so the slot is pinned as
    // null: a future adapter that carries an external ID must feed it here, and
    // doing so changes the digest — which is the intended effect.
    externalId: null,
    sourcePathHash: entry.sourcePathHash,
    entryType: entry.entryType,
    sourceFileHash: entry.sourceFileHash,
    resolvedTitle: entry.resolvedTitle,
    titleSource: entry.titleSource,
    markdown: entry.markdown,
    metadata: entry.metadata,
    revisionContentHash: entry.revisionContentHash,
    reconciliationFingerprint: entry.reconciliationFingerprint,
    mimeType: entry.mimeType,
    assetContentHash: entry.assetContentHash,
    assetSize: entry.assetSize,
    assetLastModified: entry.assetLastModified?.toISOString() ?? null,
    diagnostics: entry.diagnostics,
  };
}

export function hashImportPlan(plan: FolderImportPlan): string {
  return sha256(JSON.stringify(plan));
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
    .map((entry): DigestInput => ({ sourcePath: entry.sourcePath, serialized: JSON.stringify(hashableEntry(entry)) }))
    .sort(compareDigestOrder);
  return sha256(JSON.stringify({
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
