import { ImportGuide } from "@/components/imports/import-guide";
import { guideContent, type GuideLocale } from "@/components/imports/import-guide-content";
import { StatusMessage } from "@/components/ui/status-message";
import { importRuntimeConfig } from "@/server/import-config";
import { getSourceListModel } from "@/server/source-read";

function localeOf(lang: string | string[] | undefined): GuideLocale {
  return lang === "zh-TW" ? "zh-TW" : "en";
}

export default async function WorkspaceSourceImportGuidePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const { workspaceId } = await params;
  const { lang } = await searchParams;
  const model = await getSourceListModel(workspaceId);
  if (!model) {
    return (
      <main className="flex min-h-screen flex-col justify-center">
        <StatusMessage
          title="No workspace access"
          description="You do not have access to this workspace, or it no longer exists."
        />
      </main>
    );
  }
  const locale = localeOf(lang);
  return <ImportGuide workspaceId={workspaceId} locale={locale} content={guideContent(locale, importRuntimeConfig().limits)} />;
}
