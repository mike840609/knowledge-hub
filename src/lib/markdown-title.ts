function normalizeTitle(value: string): string {
  return value
    .replace(/[\p{Extended_Pictographic}\uFE0E\uFE0F\u200D]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

/** Keep a document's own opening heading when it repeats its saved title. */
export function markdownStartsWithDocumentTitle(markdown: string, title: string): boolean {
  const heading = markdown.match(/^\uFEFF?(?:[ \t]*\r?\n)*#\s+(.+?)(?:\r?\n|$)/)?.[1]
    ?.replace(/[ \t]+#+[ \t]*$/, "");
  return Boolean(heading && normalizeTitle(heading) === normalizeTitle(title));
}
