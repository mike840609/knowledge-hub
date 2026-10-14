import { getSyncRunDetail } from "@/server/sync-reading";
import { SyncRunDetailView } from "@/components/sources/sync-run-detail";
import { notFound } from "next/navigation";
import { RefreshOnArrival } from "@/components/shell/refresh-on-arrival";
export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; sourceId: string; runId: string }>;
  searchParams: Promise<{ after?: string }>;
}) {
  const { workspaceId, sourceId, runId } = await params;
  const { after } = await searchParams;
  const detail = await getSyncRunDetail(
    workspaceId,
    sourceId,
    runId,
    Number(after) || 0,
  );
  if (!detail) notFound();
  return (
    <main className="kh-page pb-6">
      <RefreshOnArrival pathname={`/w/${workspaceId}/sources/${sourceId}/runs/${runId}`} />
      <SyncRunDetailView detail={detail} />
    </main>
  );
}
