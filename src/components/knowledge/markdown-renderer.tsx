import type { AnchorHTMLAttributes, DetailedHTMLProps, ImgHTMLAttributes } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink } from "lucide-react";
import { remarkHeadingIds } from "@/shared/markdown/remark-heading-ids";
import { MarkdownImage } from "./markdown-image";
import { MARKDOWN_PROSE } from "./markdown-prose";

function isExternalHref(href: string): boolean {
  return href.startsWith("http://") || href.startsWith("https://") || href.startsWith("//");
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

function ScrollablePre({ children }: { children?: React.ReactNode }) {
  return (
    <div className="my-4 w-full overflow-x-auto rounded-md border border-kh-border bg-kh-bg-subtle">
      <pre className="min-w-0 px-4 py-3 font-mono text-body-sm leading-6 text-kh-text">{children}</pre>
    </div>
  );
}

export function MarkdownRenderer({ markdown }: { markdown: string }) {
  return (
    <div className={MARKDOWN_PROSE}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkHeadingIds]}
        components={{
          a: MarkdownLink,
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
          pre: ScrollablePre,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
