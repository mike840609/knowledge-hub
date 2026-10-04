import { NextRequest, NextResponse } from "next/server";
import { getSourceImportContentDiff } from "@/server/source-imports";
import { toImportErrorResponse } from "@/server/http-error-response";
export async function GET(request: NextRequest, context: { params: Promise<{ snapshotId: string }> }) {
  try {
    const { snapshotId } = await context.params;
    const diff = await getSourceImportContentDiff(snapshotId, request.nextUrl.searchParams.get("path") ?? "");
    return NextResponse.json(diff, {headers:{"Cache-Control":"private, no-store"}});
  } catch (error) {
    const mapped=toImportErrorResponse(error);
    return NextResponse.json(mapped.body,{status:mapped.status,headers:{"Cache-Control":"private, no-store"}});
  }
}
