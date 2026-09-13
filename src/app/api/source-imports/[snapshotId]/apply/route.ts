import { NextRequest, NextResponse } from "next/server";
import { toImportErrorResponse } from "@/server/http-error-response";
import { applySourceImport } from "@/server/source-imports";

export async function POST(_request: NextRequest, context: { params: Promise<{ snapshotId: string }> }) {
  try {
    const { snapshotId } = await context.params;
    const result = await applySourceImport(snapshotId);
    if (result.kind === "VERSION_CONFLICT") {
      return NextResponse.json(
        {
          error: {
            code: "SOURCE_VERSION_CONFLICT",
            message: "The source changed after this preview was created.",
            details: { sourceId: result.sourceId, currentVersion: result.currentVersion },
          },
        },
        { status: 409 },
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    const mapped = toImportErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
