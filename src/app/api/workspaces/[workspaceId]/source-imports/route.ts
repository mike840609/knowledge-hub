import { NextRequest, NextResponse } from "next/server";
import { importError } from "@/modules/sources/domain/import-errors";
import { toImportErrorResponse } from "@/server/http-error-response";
import { parseInitialImportBody } from "@/server/import-route-adapters";
import { createInitialSourceImport } from "@/server/source-imports";

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw importError("INVALID_IMPORT_MANIFEST", "Request body must be JSON.");
    }
    const { sourceName, rootName, manifest } = parseInitialImportBody(body);
    const result = await createInitialSourceImport(workspaceId, {
      sourceName: sourceName as string,
      rootName: rootName as string,
      manifest: manifest as [],
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const mapped = toImportErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
