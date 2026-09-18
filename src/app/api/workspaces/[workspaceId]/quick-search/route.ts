import { NextResponse } from "next/server";
import { getSearchPageModel } from "@/server/search-read";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const model = await getSearchPageModel(workspaceId, {
    q,
    scope: "workspace",
    sourceId: null,
    includeArchived: false,
    page: 1,
  });

  return NextResponse.json({
    hits: model.result?.hits.slice(0, 8).map((hit) => ({
      documentId: hit.documentId,
      sourceId: hit.sourceId,
      title: hit.title,
      sourceName: hit.sourceName,
      snippet: hit.snippet,
    })) ?? [],
    tooLong: model.result?.tooLong ?? false,
    timedOut: model.timedOut,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
