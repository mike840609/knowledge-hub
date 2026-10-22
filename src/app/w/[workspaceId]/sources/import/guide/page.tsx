import { redirect } from "next/navigation";

/** The guide moved to one address for everyone; an old link, its language kept, lands there. */
export default async function WorkspaceImportGuideRedirect({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const { lang } = await searchParams;
  redirect(typeof lang === "string" ? `/help/import-guide?${new URLSearchParams({ lang })}` : "/help/import-guide");
}
