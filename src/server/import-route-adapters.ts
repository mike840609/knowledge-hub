import { importError } from "@/modules/sources/domain/import-errors";

export type UploadBatchSpec = { uploadKey: string; field: string; file: File };

export function parseUploadBatchSpecs(form: FormData): UploadBatchSpec[] {
  let specs: unknown;
  try {
    specs = JSON.parse(String(form.get("entries")));
  } catch {
    throw importError("INVALID_UPLOAD_BATCH", "Upload entries must be a JSON array of { uploadKey, field }.");
  }
  if (!Array.isArray(specs)) {
    throw importError("INVALID_UPLOAD_BATCH", "Upload entries must be a JSON array of { uploadKey, field }.");
  }
  const seenKeys = new Set<string>();
  const seenFields = new Set<string>();
  const parsed: UploadBatchSpec[] = [];
  for (const spec of specs as { uploadKey: unknown; field: unknown }[]) {
    if (!spec || typeof spec.uploadKey !== "string" || !spec.uploadKey || typeof spec.field !== "string" || !spec.field) {
      throw importError("INVALID_UPLOAD_BATCH", "Upload entries must be a JSON array of { uploadKey, field }.");
    }
    if (seenKeys.has(spec.uploadKey) || seenFields.has(spec.field)) {
      throw importError("INVALID_UPLOAD_BATCH", "Upload entries must have unique upload keys and fields.");
    }
    seenKeys.add(spec.uploadKey);
    seenFields.add(spec.field);
    const file = form.get(spec.field);
    if (!(file instanceof File)) {
      throw importError("INVALID_UPLOAD_BATCH", "Every upload entry must reference a File part.");
    }
    parsed.push({ uploadKey: spec.uploadKey, field: spec.field, file });
  }
  return parsed;
}

export function parseInitialImportBody(body: unknown): { sourceName: unknown; rootName: unknown; manifest: unknown } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw importError("INVALID_IMPORT_MANIFEST", "Request body must be a JSON object.");
  }
  const { sourceName, rootName, manifest } = body as { sourceName: unknown; rootName: unknown; manifest: unknown };
  return { sourceName, rootName, manifest };
}

export function parseResyncImportBody(body: unknown): { rootName: unknown; manifest: unknown } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw importError("INVALID_IMPORT_MANIFEST", "Request body must be a JSON object.");
  }
  const { rootName, manifest } = body as { rootName: unknown; manifest: unknown };
  return { rootName, manifest };
}
