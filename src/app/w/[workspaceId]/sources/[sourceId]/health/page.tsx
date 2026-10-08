import { notFound } from "next/navigation";
import { getSourceHealth } from "@/server/source-health";
import { SourceHealth } from "@/components/sources/source-health";
export default async function HealthPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; sourceId: string }>;
  searchParams: Promise<{ after?: string }>;
}) {
  const { workspaceId, sourceId } = await params;
  const { after } = await searchParams;
  const model = await getSourceHealth(workspaceId, sourceId, after);
  if (!model) notFound();
  return (
    <main className="kh-page pb-6">
      <SourceHealth model={model} />
    </main>
  );
}
