import { getCurrentIdentity } from "@/modules/identity/application/get-current-identity";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { CreateImportResult, ImportManifestEntry } from "@/modules/sources/application/create-folder-import";
import type { UploadImportResult } from "@/modules/sources/application/upload-folder-import-entries";
import type { ImportPreview } from "@/modules/sources/application/reconcile-import-snapshot";
import type { ApplyFolderImportResult } from "@/modules/sources/application/apply-folder-import";
import { applicationServices } from "@/server/composition";

export type InitialImportRequest = { sourceName: string; rootName: string; manifest: ImportManifestEntry[] };
export type ResyncRequest = { rootName: string; manifest: ImportManifestEntry[] };

/**
 * Caller identity comes only from the trusted provider; payloads carry folder content, never actor overrides.
 *
 * The raw manifest is untrusted JSON: elements may not be objects at all, so
 * revival must never read fields before checking. Invalid elements pass
 * through untouched for the application manifest validator to report as
 * INVALID_IMPORT_MANIFEST (400), instead of throwing a TypeError (500).
 * Date revival is kind-independent because the application classifies
 * Markdown vs Asset by server-side file extension; the client kind hint must
 * not decide whether the same asset metadata is accepted.
 */
export function reviveManifest(manifest: unknown): ImportManifestEntry[] {
  if (!Array.isArray(manifest)) return manifest as ImportManifestEntry[];
  return (manifest as unknown[]).map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry as ImportManifestEntry;
    const lastModified = (entry as { lastModified?: unknown }).lastModified;
    if (typeof lastModified !== "string") return entry as ImportManifestEntry;
    return { ...(entry as Record<string, unknown>), lastModified: new Date(lastModified) } as ImportManifestEntry;
  });
}

export async function createInitialSourceImport(workspaceId: string, input: InitialImportRequest): Promise<CreateImportResult> {
  const services = applicationServices();
  const caller = callerFromIdentity(await getCurrentIdentity(services.identityProvider));
  return services.imports.create.createInitial(caller, {
    workspaceId,
    sourceName: input.sourceName,
    rootName: input.rootName,
    manifest: reviveManifest(input.manifest),
  });
}

export async function createSourceResync(sourceId: string, input: ResyncRequest): Promise<CreateImportResult> {
  const services = applicationServices();
  const caller = callerFromIdentity(await getCurrentIdentity(services.identityProvider));
  return services.imports.create.createResync(caller, {
    sourceId,
    rootName: input.rootName,
    manifest: reviveManifest(input.manifest),
  });
}

export async function uploadSourceImportEntries(
  snapshotId: string,
  entries: { uploadKey: string; bytes: Uint8Array }[],
): Promise<UploadImportResult> {
  const services = applicationServices();
  const caller = callerFromIdentity(await getCurrentIdentity(services.identityProvider));
  return services.imports.upload.upload(caller, { snapshotId, entries });
}

export async function finalizeSourceImport(snapshotId: string): Promise<ImportPreview> {
  const services = applicationServices();
  const caller = callerFromIdentity(await getCurrentIdentity(services.identityProvider));
  return services.imports.finalize.finalize(caller, snapshotId);
}

export async function getSourceImportPreview(snapshotId: string): Promise<ImportPreview> {
  const services = applicationServices();
  const caller = callerFromIdentity(await getCurrentIdentity(services.identityProvider));
  return services.imports.preview.get(caller, snapshotId);
}

export async function applySourceImport(snapshotId: string): Promise<ApplyFolderImportResult> {
  const services = applicationServices();
  const caller = callerFromIdentity(await getCurrentIdentity(services.identityProvider));
  return services.imports.apply.apply(caller, snapshotId);
}
