import { redirect } from "next/navigation";

/** The guide moved to one address for everyone; an old link, its language kept, lands there. */
export default async function WorkspaceUserGuideRedirect({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams;
  redirect(typeof lang === "string" ? `/help?${new URLSearchParams({ lang })}` : "/help");
}
