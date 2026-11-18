import { applicationServices } from "@/server/composition";
import { FreshnessReminders } from "@/components/knowledge/freshness-reminders";
import { FRESHNESS_KEY, freshnessThreshold, knowledgeFreshness } from "@/modules/personal/application/knowledge-freshness";
import Link from "next/link";
import { importRuntimeConfig } from "@/server/import-config";
import { notFound } from "next/navigation";
import { WorkspaceImportLink } from "@/components/shell/workspace-import-link";
import { SourceList } from "@/components/sources/source-list";
import { getSourceListModel } from "@/server/source-read";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";

export const metadata = { title: "Sources" };

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
  // One answer per folder: freshness is a state of the row above, not a second
  // list below it. The reminder settings stay where they were, at the end.
  const now = new Date();
  const freshness = new Map((preference ? knowledgeFreshness(model.items, freshnessThreshold(preference.value), now) : [])
    .map(reminder => [reminder.sourceId, reminder]));
  return (
    <div className="kh-page-wide pb-6">
      <PageHeader
        location={model.workspace.name}
        locationHref={`/w/${workspaceId}/home`}
        title="Sources"
        description={preference ? `Folders older than ${freshnessThreshold(preference.value)} days without a successful sync are marked Stale.` : undefined}
        // The empty state carries the same action as its primary; two of them on one screen is one too many.
        actions={<>{model.items.length === 0 ? null : <WorkspaceImportLink
          className={buttonClasses()}
          href={`/w/${workspaceId}/sources/import`}
        >
          Import folder
        </WorkspaceImportLink>}</>}
      />
      <div className="mt-6">
        <SourceList workspaceId={workspaceId} items={model.items} freshness={freshness} limits={{ maxMarkdownFileBytes: limits.maxMarkdownFileBytes, maxAssetFileBytes: limits.maxAssetFileBytes, maxAssetTotalBytes: limits.maxAssetTotalBytes }} />
      </div>
      {preference ? <div className="-mx-3 mt-6"><FreshnessReminders workspaceId={workspaceId} items={model.items} preference={{thresholdDays: freshnessThreshold(preference.value), version: preference.version}} /></div> : null}
      {model.workspace.type === "PERSONAL" ? <div className="mt-3 px-3"><Link className="kh-focus-ring inline-flex min-h-6 items-center rounded-md text-body-sm text-kh-link" href={`/w/${workspaceId}/sources/health`}>Check source health</Link></div> : null}
    </div>
  );
}
