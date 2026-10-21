import { Children, isValidElement, type ReactNode } from "react";
import { remarkCallouts } from "@/shared/markdown/remark-callouts";
import { remarkHtmlSubset } from "@/shared/markdown/remark-html-subset";
import { codeHighlightPlugins } from "./code-highlight";
import { CodeBlock } from "./code-block";
import { MarkdownBase } from "./markdown-base";
import { MermaidBlock } from "./mermaid-block";
import type { RenderedLinks } from "./rendered-links";

type CodeProps = { className?: string; "data-lines"?: number };

/**
 * The language a `<pre>`'s fence names, as written (`language-x` on its `<code>`), and the lines
 * `rehypeCodeLines` counted. The reader does not guess a language.
 */
function codeOf(children: ReactNode): { language?: string; lines: number } {
  const code = Children.toArray(children).find((child) => isValidElement<CodeProps>(child));
  if (!isValidElement<CodeProps>(code)) return { lines: 0 };
  const language = (code.props.className ?? "").split(/\s+/).find((name) => name.startsWith("language-"))?.slice("language-".length);
  return { language: language || undefined, lines: Number(code.props["data-lines"]) || 0 };
}

function ReadingPre({ children }: { children?: ReactNode }) {
  const { language, lines } = codeOf(children);
  const block = <CodeBlock language={language} lines={lines}>{children}</CodeBlock>;
  return language === "mermaid" ? <MermaidBlock>{block}</MermaidBlock> : block;
}

const readerRemarkPlugins = [remarkCallouts, remarkHtmlSubset];

/**
 * Markdown as the reader and a shared page show it: the product's typesetting (`MarkdownBase`),
 * with fenced code coloured (`code-highlight.ts`), each block labelled with its language, a button to copy it, a long one collapsed (`code-block.tsx`), a `mermaid` block drawn as its diagram (`mermaid-block.tsx`), `> [!NOTE]` and
 * its kin drawn as callouts, and a small subset of HTML drawn as what it means.
 *
 * Not for the composer, which is a client component and must not carry the highlighter: it uses
 * `MarkdownBase`. `links` is as there — a shared page passes none.
 */
export function MarkdownRenderer({ markdown, links, afterTitle }: { markdown: string; links?: RenderedLinks; afterTitle?: ReactNode }) {
  return <MarkdownBase markdown={markdown} links={links} remarkPlugins={readerRemarkPlugins} rehypePlugins={codeHighlightPlugins} pre={ReadingPre} afterTitle={afterTitle} />;
}
