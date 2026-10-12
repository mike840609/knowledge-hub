import type { ReactNode } from "react";

/**
 * How the HTML subset is drawn (`remark-html-subset.ts` makes the elements; design language §8,
 * "HTML in a document"). `<u>`, `<sub>` and `<sup>` are the browser's.
 */
export function MarkdownKbd({ children }: { children?: ReactNode }) {
  return <kbd className="rounded-sm border border-kh-border bg-kh-bg-subtle px-1 font-mono text-body-sm">{children}</kbd>;
}

export function MarkdownMark({ children }: { children?: ReactNode }) {
  return <mark className="rounded-sm bg-kh-highlight px-0.5 text-kh-selected-text">{children}</mark>;
}

/** A disclosure. The body is the one `<div>` the plugin puts after the summary: indented, on a line of its own. */
export function MarkdownDetails({ children, open }: { children?: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="my-3 [&>div]:ml-1 [&>div]:border-l-2 [&>div]:border-kh-border [&>div]:pl-4">
      {children}
    </details>
  );
}

export function MarkdownSummary({ children }: { children?: ReactNode }) {
  return <summary className="kh-focus-ring cursor-pointer rounded-md font-medium">{children}</summary>;
}
