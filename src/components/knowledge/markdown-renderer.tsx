import type { AnchorHTMLAttributes, DetailedHTMLProps, ImgHTMLAttributes } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink } from "lucide-react";
import { MarkdownImage } from "./markdown-image";

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
        className="rounded font-medium text-kh-accent underline decoration-kh-accent/40 underline-offset-2 hover:decoration-kh-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-accent"
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
      className="rounded font-medium text-kh-accent underline decoration-kh-accent/40 underline-offset-2 hover:decoration-kh-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-accent"
    >
      {children}
    </a>
  );
}

function ResponsiveTable({ children }: { children?: React.ReactNode }) {
  return (
    <div className="my-4 w-full overflow-x-auto rounded-md border border-kh-border">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

function ScrollablePre({ children }: { children?: React.ReactNode }) {
  return (
    <div className="my-4 w-full overflow-x-auto rounded-md border border-kh-border bg-kh-bg-subtle">
      <pre className="min-w-0 px-4 py-3 font-mono text-[13px] leading-6 text-kh-text">{children}</pre>
    </div>
  );
}

export function MarkdownRenderer({ markdown }: { markdown: string }) {
  return (
    <div className="min-w-0 text-[15px] leading-7 text-kh-text [&_h1]:mt-6 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mt-5 [&_h3]:text-base [&_h3]:font-semibold [&_h4]:mt-4 [&_h4]:text-sm [&_h4]:font-semibold [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_td]:border-t [&_td]:border-kh-border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:bg-kh-bg-subtle [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_tr]:border-kh-border [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_blockquote]:border-l-2 [&_blockquote]:border-kh-border [&_blockquote]:pl-4 [&_blockquote]:text-kh-text-muted [&_code]:rounded [&_code]:bg-kh-bg-subtle [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_hr]:my-6 [&_hr]:border-kh-border">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: MarkdownLink,
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
