import { NextRequest, NextResponse } from "next/server";
import { importError } from "@/modules/sources/domain/import-errors";
import { importRuntimeConfig } from "@/server/import-config";
import { toImportErrorResponse } from "@/server/http-error-response";
import { validateUploadContentLength } from "@/server/import-route-adapters";
import { uploadSourceImportAsset } from "@/server/source-imports";

export async function PUT(request: NextRequest, context: { params: Promise<{ snapshotId: string }> }) {
  try {
    const { snapshotId } = await context.params;
    const contentLength = validateUploadContentLength(request.headers.get("content-length"), importRuntimeConfig().limits.maxAssetFileBytes);
    if (!request.body) throw importError("INVALID_UPLOAD_BATCH", "An image upload requires a body.");
    const uploadKey = request.nextUrl.searchParams.get("uploadKey") ?? "";
    return NextResponse.json(await uploadSourceImportAsset(snapshotId, { uploadKey, body: request.body, contentLength }));
  } catch (error) {
    // The image volume is full: nothing was applied, and it is the operator's to fix.
    if ((error as NodeJS.ErrnoException).code === "ENOSPC") {
      return NextResponse.json({ error: { code: "IMAGE_STORAGE_FULL", message: "The server's image storage is full. Nothing was synced." } }, { status: 507 });
    }
    const mapped = toImportErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
