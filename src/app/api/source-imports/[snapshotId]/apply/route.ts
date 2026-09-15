import { NextRequest, NextResponse } from "next/server";
import { toImportErrorResponse } from "@/server/http-error-response";
import { importError } from "@/modules/sources/domain/import-errors";
import { applySourceImport } from "@/server/source-imports";

export async function POST(_request: NextRequest, context: { params: Promise<{ snapshotId: string }> }) {
  try {
    const { snapshotId } = await context.params;
    const result = await applySourceImport(snapshotId);
    if (result.kind === "VERSION_CONFLICT") {
      const mapped = toImportErrorResponse(
        importError("SOURCE_VERSION_CONFLICT", "The source changed after this preview was created.", {
          snapshotVersion: result.snapshotVersion,
          currentVersion: result.currentVersion,
        }),
      );
      return NextResponse.json(mapped.body, { status: mapped.status });
    }
    return NextResponse.json(result);
  } catch (error) {
    const mapped = toImportErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
