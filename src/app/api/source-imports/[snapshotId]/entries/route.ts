import { NextRequest, NextResponse } from "next/server";
import { importError } from "@/modules/sources/domain/import-errors";
import { importRuntimeConfig } from "@/server/import-config";
import { toImportErrorResponse } from "@/server/http-error-response";
import { uploadSourceImportEntries } from "@/server/source-imports";

const ONE_MIB = 1024 * 1024;

type EntrySpec = { uploadKey: unknown; field: unknown };

export async function POST(request: NextRequest, context: { params: Promise<{ snapshotId: string }> }) {
  try {
    const { snapshotId } = await context.params;
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (declaredLength > importRuntimeConfig().limits.maxUploadBatchBytes + ONE_MIB) {
      throw importError("IMPORT_LIMIT_EXCEEDED", "Upload batch exceeds the configured byte limits.");
    }
    const form = await request.formData();
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
    const payload: { uploadKey: string; bytes: Uint8Array }[] = [];
    for (const spec of specs as EntrySpec[]) {
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
      payload.push({ uploadKey: spec.uploadKey, bytes: new Uint8Array(await file.arrayBuffer()) });
    }
    const result = await uploadSourceImportEntries(snapshotId, payload);
    return NextResponse.json(result);
  } catch (error) {
    const mapped = toImportErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
