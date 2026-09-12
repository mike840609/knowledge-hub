import { getCurrentIdentity } from "@/modules/identity/application/get-current-identity";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { CreateImportResult, ImportManifestEntry } from "@/modules/sources/application/create-folder-import";
import type { UploadImportResult } from "@/modules/sources/application/upload-folder-import-entries";
import type { ImportPreview } from "@/modules/sources/application/reconcile-import-snapshot";
import type { ApplyFolderImportResult } from "@/modules/sources/application/apply-folder-import";
import { applicationServices } from "@/server/composition";

export type InitialImportRequest = { sourceName: string; rootName: string; manifest: ImportManifestEntry[] };
export type ResyncRequest = { rootName: string; manifest: ImportManifestEntry[] };

/** Caller identity comes only from the trusted provider; payloads carry folder content, never actor overrides. */
function reviveManifest(manifest: ImportManifestEntry[]): ImportManifestEntry[] {
  if (!Array.isArray(manifest)) return manifest;
  return manifest.map((entry) => {
    if (entry.kind !== "ASSET" || entry.lastModified instanceof Date || entry.lastModified === null) return entry;
    return { ...entry, lastModified: new Date(entry.lastModified as unknown as string) };
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
