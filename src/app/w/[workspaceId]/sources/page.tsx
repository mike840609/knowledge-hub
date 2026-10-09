import { applicationServices } from "@/server/composition";
import { FreshnessReminders } from "@/components/knowledge/freshness-reminders";
import { FRESHNESS_KEY, freshnessThreshold } from "@/modules/personal/application/knowledge-freshness";
import Link from "next/link";
import { importRuntimeConfig } from "@/server/import-config";
import { notFound } from "next/navigation";
import { WorkspaceImportLink } from "@/components/shell/workspace-import-link";
import { SourceList } from "@/components/sources/source-list";
import { getSourceListModel } from "@/server/source-read";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";

export default async function WorkspaceSourcesPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const model = await getSourceListModel(workspaceId);
  if (!model) notFound();
  const preference = model.workspace.type === "PERSONAL" ? await (async () => {
    const services = applicationServices();
    const { caller } = await services.establishTrustedCaller();
    return services.personalPreferences.get(caller, workspaceId, FRESHNESS_KEY);
  })() : null;
  const limits = importRuntimeConfig().limits;
  return (
    <main className="kh-page pb-6">
      <PageHeader
        location={model.workspace.name}
        locationHref={`/w/${workspaceId}/knowledge`}
        title="Sources"
        description={`${model.items.length} ${model.items.length === 1 ? "source" : "sources"}`}
        // The empty state carries the same action as its primary; two of them on one screen is one too many.
        actions={model.items.length === 0 ? undefined : <WorkspaceImportLink
          className={buttonClasses({ variant: "secondary" })}
          href={`/w/${workspaceId}/sources/import`}
        >
          Import folder
        </WorkspaceImportLink>}
      />
      {model.workspace.type === "PERSONAL" ? <div className="mt-3"><Link className={buttonClasses({variant:"secondary"})} href={`/w/${workspaceId}/sources/health`}>Check source health</Link></div> : null}
      <div className="mt-6">
        <SourceList workspaceId={workspaceId} items={model.items} limits={{ maxAssetFileBytes: limits.maxAssetFileBytes, maxAssetTotalBytes: limits.maxAssetTotalBytes }} />
      </div>
      {preference ? <div className="mt-6"><FreshnessReminders workspaceId={workspaceId} items={model.items} preference={{thresholdDays: freshnessThreshold(preference.value), version: preference.version}} now={new Date().toISOString()} /></div> : null}
    </main>
  );
}
