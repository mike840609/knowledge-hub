import type { ReactNode } from "react";
import { remarkCallouts } from "@/shared/markdown/remark-callouts";
import { remarkHtmlSubset } from "@/shared/markdown/remark-html-subset";
import { codeHighlightPlugins } from "./code-highlight";
import { CopyCodeButton } from "./copy-code-button";
import { MarkdownBase, ScrollablePre } from "./markdown-base";
import type { RenderedLinks } from "./rendered-links";

function ReadingPre({ children }: { children?: ReactNode }) {
  return <ScrollablePre action={<CopyCodeButton />}>{children}</ScrollablePre>;
}

const readerRemarkPlugins = [remarkCallouts, remarkHtmlSubset];

/**
 * Markdown as the reader and a shared page show it: the product's typesetting (`MarkdownBase`),
 * with fenced code coloured (`code-highlight.ts`), a button to copy each block, `> [!NOTE]` and
 * its kin drawn as callouts, and a small subset of HTML drawn as what it means.
 *
 * Not for the composer, which is a client component and must not carry the highlighter: it uses
 * `MarkdownBase`. `links` is as there — a shared page passes none.
 */
export function MarkdownRenderer({ markdown, links }: { markdown: string; links?: RenderedLinks }) {
  return <MarkdownBase markdown={markdown} links={links} remarkPlugins={readerRemarkPlugins} rehypePlugins={codeHighlightPlugins} pre={ReadingPre} />;
}
