import { NextRequest, NextResponse } from "next/server";
import { toImportErrorResponse } from "@/server/http-error-response";
import { getSourceImportPreview } from "@/server/source-imports";

export async function GET(_request: NextRequest, context: { params: Promise<{ snapshotId: string }> }) {
  try {
    const { snapshotId } = await context.params;
    const preview = await getSourceImportPreview(snapshotId);
    return NextResponse.json(preview);
  } catch (error) {
    const mapped = toImportErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
