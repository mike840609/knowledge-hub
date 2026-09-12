import { NextRequest, NextResponse } from "next/server";
import { importError } from "@/modules/sources/domain/import-errors";
import { toImportErrorResponse } from "@/server/http-error-response";
import { createSourceResync } from "@/server/source-imports";

export async function POST(request: NextRequest, context: { params: Promise<{ sourceId: string }> }) {
  try {
    const { sourceId } = await context.params;
    let body: { rootName: string; manifest: [] };
    try {
      body = await request.json();
    } catch {
      throw importError("INVALID_IMPORT_MANIFEST", "Request body must be JSON.");
    }
    const result = await createSourceResync(sourceId, { rootName: body.rootName, manifest: body.manifest });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const mapped = toImportErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
