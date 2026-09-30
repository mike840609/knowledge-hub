import Link from "next/link";
import type { AnchorHTMLAttributes, ComponentType, DetailedHTMLProps, ImgHTMLAttributes, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PluggableList } from "unified";
import { ExternalLink } from "lucide-react";
import { parseDocumentHref } from "@/modules/knowledge/domain/document-links";
import { linkLookupKey } from "@/modules/knowledge/domain/link-graph";
import { headingSlug } from "@/shared/markdown/heading-slug";
import { remarkHeadingIds } from "@/shared/markdown/remark-heading-ids";
import { MarkdownImage } from "./markdown-image";
import { MARKDOWN_PROSE } from "./markdown-prose";
import type { RenderedLinks } from "./rendered-links";
import { remarkKnowledgeLinks, WIKILINK_ANCHOR, WIKILINK_FRAGMENT, WIKILINK_TARGET } from "./remark-knowledge-links";

function isExternalHref(href: string): boolean {
  return href.startsWith("http://") || href.startsWith("https://") || href.startsWith("//");
}

type AnchorProps = DetailedHTMLProps<AnchorHTMLAttributes<HTMLAnchorElement>, HTMLAnchorElement> & {
  [WIKILINK_TARGET]?: string;
  [WIKILINK_FRAGMENT]?: string;
  [WIKILINK_ANCHOR]?: string;
};

const INTERNAL_LINK_CLASS =
  "rounded-md font-medium text-kh-link underline decoration-kh-link underline-offset-2 hover:decoration-kh-link kh-focus-ring";

/**
 * A link to a document that is not there. Dashed rather than absent, so the
 * reader can see that something was meant to be linked here; a tooltip says
 * what, and assistive technology gets the same in words.
 */
function UnresolvedLink({ children, what }: { children: React.ReactNode; what: string }) {
  return (
    <span data-unresolved-link title={what} className="cursor-help border-b border-dashed border-kh-text-muted text-kh-text-secondary">
      {children}
      <span className="sr-only"> (no matching document)</span>
    </span>
  );
}

/** A link to another document, inside the workspace the reader is in. */
function DocumentLink({
  target,
  fragment,
  children,
}: {
  target: { basePath: string; title: string; ambiguousWith: number };
  fragment: string | null;
  children: React.ReactNode;
}) {
  const hash = fragment === null || fragment === "" ? "" : `#${encodeURIComponent(fragment)}`;
  const shared = target.ambiguousWith > 0 ? `${target.ambiguousWith} other document${target.ambiguousWith === 1 ? "" : "s"} share this name` : undefined;
  return (
    // Not prefetched: the renderer does not know which document it is in, and a
    // link to the page it is on (`[[This page's own title]]`) prefetched from
    // itself is the hazard the tree avoids — see LocalGraph. A click still
    // fetches the page; only the speculative fetch is given up.
    <Link href={`${target.basePath}${hash}`} prefetch={false} title={shared ?? target.title} className={INTERNAL_LINK_CLASS}>
      {children}
    </Link>
  );
}

function MarkdownAnchor({ links, ...props }: AnchorProps & { links?: RenderedLinks }) {
  const wikiTarget = props[WIKILINK_TARGET];
  const anchor = props[WIKILINK_ANCHOR];
  const { children } = props;

  // [[#Heading]]: a link within this page.
  if (anchor !== undefined) {
    return (
      <a href={`#${encodeURIComponent(anchor)}`} className={INTERNAL_LINK_CLASS}>
        {children}
      </a>
    );
  }

  // [[Target]] and friends. Without resolutions — a shared page, where the
  // reader has no access to the workspace — it is just its text.
  if (wikiTarget !== undefined) {
    if (!links) return <span>{children}</span>;
    const resolved = links[linkLookupKey("WIKI", wikiTarget)];
    if (!resolved || resolved.status === "UNRESOLVED") {
      return <UnresolvedLink what={`No document titled “${wikiTarget}” in this workspace`}>{children}</UnresolvedLink>;
    }
    const fragment = props[WIKILINK_FRAGMENT];
    return (
      <DocumentLink target={resolved} fragment={fragment === undefined ? null : headingSlug(fragment)}>
        {children}
      </DocumentLink>
    );
  }

  // [text](../other.md): a relative link to a Markdown file is a link to a document.
  const document = props.href ? parseDocumentHref(props.href) : null;
  if (document) {
    if (!links) return <span>{children}</span>;
    const resolved = links[linkLookupKey("PATH", document.target)];
    if (!resolved || resolved.status === "UNRESOLVED") {
      return <UnresolvedLink what={`No document at “${document.target}” in this source`}>{children}</UnresolvedLink>;
    }
    return (
      <DocumentLink target={resolved} fragment={document.fragment}>
        {children}
      </DocumentLink>
    );
  }

  return <MarkdownLink {...props} />;
}

function MarkdownLink(props: DetailedHTMLProps<AnchorHTMLAttributes<HTMLAnchorElement>, HTMLAnchorElement>) {
  const { href, children, ...rest } = props;
  if (href && isExternalHref(href)) {
    return (
      <a
        {...rest}
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="rounded-md font-medium text-kh-link underline decoration-kh-link underline-offset-2 hover:decoration-kh-link kh-focus-ring"
      >
        {children}
        <ExternalLink className="ml-0.5 inline h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  }
  return (
    <a
      {...rest}
      href={href}
      className="rounded-md font-medium text-kh-link underline decoration-kh-link underline-offset-2 hover:decoration-kh-link kh-focus-ring"
    >
      {children}
    </a>
  );
}

function ResponsiveTable({ children }: { children?: React.ReactNode }) {
  return (
    <div className="my-4 w-full overflow-x-auto rounded-md border border-kh-border">
      <table className="w-full border-collapse text-body">{children}</table>
    </div>
  );
}

/**
 * A code block: the code in a box that scrolls sideways, and room in its corner for `action`.
 * The corner belongs to the box rather than to the scroller inside it, so what sits there stays
 * put while a long line scrolls under it.
 */
export function ScrollablePre({ children, action }: { children?: ReactNode; action?: ReactNode }) {
  return (
    <div data-code-block className="relative my-4 w-full rounded-md border border-kh-border bg-kh-bg-subtle">
      <div className="w-full overflow-x-auto rounded-md">
        <pre className="min-w-0 px-4 py-3 font-mono text-body-sm leading-6 text-kh-text">{children}</pre>
      </div>
      {action}
    </div>
  );
}

/**
 * Markdown as this product typesets it, and nothing else: no colour in the code, no copy button.
 *
 * That is deliberate. The composer shows this while its editor loads, and it must look like the
 * editor it stands in for, whose code blocks are plain; and the composer is a client component,
 * so what this file imports goes to the browser. Lowlight and its grammars would be a large
 * addition to what the composer sends for nothing it shows, so they are not imported here. The
 * reader's renderer (`markdown-renderer.tsx`) is this plus both, through `rehypePlugins` and `pre`.
 * `tests/unit/composer-bundle.test.ts` holds the line.
 *
 * `links` says where each `[[wikilink]]` and relative `.md` link goes. Without
 * it — a shared page, or anywhere the reader is not in the workspace — those
 * read as plain text rather than as links into content the reader may not
 * have, and nothing is looked up.
 */
export function MarkdownBase({
  markdown,
  links,
  rehypePlugins,
  pre = ScrollablePre,
}: {
  markdown: string;
  links?: RenderedLinks;
  rehypePlugins?: PluggableList;
  /** How a code block is drawn; `ScrollablePre` unless the caller has more to put in it. */
  pre?: ComponentType<{ children?: ReactNode }>;
}) {
  return (
    <div className={MARKDOWN_PROSE}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkHeadingIds, remarkKnowledgeLinks]}
        rehypePlugins={rehypePlugins}
        components={{
          a: (props: AnchorProps) => <MarkdownAnchor {...props} links={links} />,
          // Image URL policy (issue #20, see markdown-image-policy.ts):
          // default-deny remote images — only relative Knowledge Hub asset
          // URLs and same-origin absolute URLs render via MarkdownImage;
          // arbitrary http(s) (incl. protocol-relative //), data:, and other
          // schemes render a safe blocked placeholder and never reach <img>.
          // Links (MarkdownLink above) are unaffected by design: clicking a
          // link is explicit user action, <img> fetches automatically.
          img: ({ src, alt }: DetailedHTMLProps<ImgHTMLAttributes<HTMLImageElement>, HTMLImageElement>) => (
            <MarkdownImage src={typeof src === "string" ? src : undefined} alt={alt} />
          ),
          table: ResponsiveTable,
          pre,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
