import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import { markdownOpensWithHeading } from "@/lib/markdown-title";

export type AuthoredTitleSource = "METADATA" | "H1" | "TYPED";
export type AuthoredTitle = { title: string; source: AuthoredTitleSource };

/**
 * The title a document written in the Hub is saved under (composer spec §4).
 * Metadata first, so a revision never disagrees with the frontmatter title it
 * carries; then the H1 the document opens with, because that is the title the
 * reader shows; then whatever was typed into the title field.
 */
export function resolveAuthoredTitle(input: { metadataTitle: unknown; markdown: string; typedTitle: string }): AuthoredTitle {
  const metadataTitle = typeof input.metadataTitle === "string" ? input.metadataTitle.trim() : "";
  if (metadataTitle) return { title: metadataTitle, source: "METADATA" };
  const heading = openingHeadingText(input.markdown);
  if (heading) return { title: heading, source: "H1" };
  return { title: input.typedTitle.trim(), source: "TYPED" };
}

/**
 * "Opens with" is the reader's test (`markdownOpensWithHeading`), so the editor
 * names the document by the heading the reader shows as its title. The text is
 * read the way folder import reads an H1, so one file yields one title.
 */
function openingHeadingText(markdown: string): string {
  if (!markdownOpensWithHeading(markdown)) return "";
  // An ATX heading is one line: parsing only it, not the rest of a
  // potentially large document, keeps this cheap to run on every keystroke.
  const first = fromMarkdown(firstNonBlankLine(markdown)).children[0];
  if (first?.type !== "heading" || first.depth !== 1) return "";
  return toString(first).trim();
}

/** Strips a leading BOM and blank lines, the way `markdownOpensWithHeading` does, then takes one line. */
function firstNonBlankLine(markdown: string): string {
  const withoutBom = markdown.startsWith("﻿") ? markdown.slice(1) : markdown;
  for (const line of withoutBom.split(/\r?\n/)) {
    if (line.trim() !== "") return line;
  }
  return "";
}

/** Deleting the opening H1 reveals the title field; it starts with the title the H1 was giving. */
export function carryTitle(before: AuthoredTitle, after: AuthoredTitle, typedTitle: string): string {
  return before.source === "H1" && after.source === "TYPED" ? before.title : typedTitle;
}
