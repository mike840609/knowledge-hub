import { ImportGuide } from "@/components/imports/import-guide";
import { guideContent, type GuideLocale } from "@/components/imports/import-guide-content";
import { importRuntimeConfig } from "@/server/import-config";
import { helpWorkspaceId } from "@/server/help-read";

/** Traditional Chinese unless English is asked for, as the user guide beside it. */
function localeOf(lang: string | string[] | undefined): GuideLocale {
  return lang === "en" ? "en" : "zh-TW";
}

/** The folder format guide, one address for everyone; its way back leads to the reader's own import form. */
export default async function SourceImportGuidePage({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const { lang } = await searchParams;
  const locale = localeOf(lang);
  return <ImportGuide workspaceId={await helpWorkspaceId()} locale={locale} content={guideContent(locale, importRuntimeConfig().limits)} />;
}
