import { NextRequest, NextResponse } from "next/server";
import { importError } from "@/modules/sources/domain/import-errors";
import { toImportErrorResponse } from "@/server/http-error-response";
import { parseResyncImportBody } from "@/server/import-route-adapters";
import { createSourceResync } from "@/server/source-imports";

export async function POST(request: NextRequest, context: { params: Promise<{ sourceId: string }> }) {
  try {
    const { sourceId } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw importError("INVALID_IMPORT_MANIFEST", "Request body must be JSON.");
    }
    const { rootName, manifest } = parseResyncImportBody(body);
    const result = await createSourceResync(sourceId, { rootName: rootName as string, manifest: manifest as [] });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const mapped = toImportErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
