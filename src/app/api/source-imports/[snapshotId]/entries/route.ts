import { NextRequest, NextResponse } from "next/server";
import { importError } from "@/modules/sources/domain/import-errors";
import { importRuntimeConfig } from "@/server/import-config";
import { toImportErrorResponse } from "@/server/http-error-response";
import { parseUploadBatchSpecs } from "@/server/import-route-adapters";
import { uploadSourceImportEntries } from "@/server/source-imports";

const ONE_MIB = 1024 * 1024;

export async function POST(request: NextRequest, context: { params: Promise<{ snapshotId: string }> }) {
  try {
    const { snapshotId } = await context.params;
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (declaredLength > importRuntimeConfig().limits.maxUploadBatchBytes + ONE_MIB) {
      throw importError("IMPORT_LIMIT_EXCEEDED", "Upload batch exceeds the configured byte limits.");
    }
    const specs = parseUploadBatchSpecs(await request.formData());
    const payload: { uploadKey: string; bytes: Uint8Array }[] = [];
    for (const spec of specs) {
      payload.push({ uploadKey: spec.uploadKey, bytes: new Uint8Array(await spec.file.arrayBuffer()) });
    }
    const result = await uploadSourceImportEntries(snapshotId, payload);
    return NextResponse.json(result);
  } catch (error) {
    const mapped = toImportErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
