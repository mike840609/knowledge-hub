import { redirect } from "next/navigation";

/** The format guide became the user guide's reference part; an old link, its language kept, lands there. */
export default async function ImportGuideRedirect({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const { lang } = await searchParams;
  redirect(typeof lang === "string" ? `/help?${new URLSearchParams({ lang })}#format-reference` : "/help#format-reference");
}
