import { NextResponse } from "next/server";
import { getSourceImportDiff } from "@/server/source-imports";
import { toImportErrorResponse } from "@/server/http-error-response";
export async function GET(
  request: Request,
  context: { params: Promise<{ snapshotId: string }> },
) {
  try {
    const { snapshotId } = await context.params;
    const path = new URL(request.url).searchParams.get("path") ?? "";
    return NextResponse.json(await getSourceImportDiff(snapshotId, path), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const mapped = toImportErrorResponse(error);
    return NextResponse.json(mapped.body, {
      status: mapped.status,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
