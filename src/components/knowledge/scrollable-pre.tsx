import type { ReactNode } from "react";

/**
 * A code block: the code in a box that scrolls sideways, and room in its corner for `action`.
 * The corner belongs to the box rather than to the scroller inside it, so what sits there stays
 * put while a long line scrolls under it. `footer` sits below the scroller, inside the box.
 *
 * A file of its own, with no imports, so the reader's client `CodeBlock` can draw the same box
 * without pulling `markdown-base.tsx`'s Markdown stack into the browser.
 */
export function ScrollablePre({ children, action, footer, scrollerId, scrollerClassName = "" }: { children?: ReactNode; action?: ReactNode; footer?: ReactNode; scrollerId?: string; scrollerClassName?: string }) {
  return (
    <div data-code-block className="relative my-4 w-full rounded-md border border-kh-border bg-kh-bg-subtle">
      <div id={scrollerId} className={`w-full overflow-x-auto rounded-md ${scrollerClassName}`}>
        <pre className="min-w-0 px-4 py-3 font-mono text-body-sm leading-6 text-kh-text">{children}</pre>
      </div>
      {footer}
      {action}
    </div>
  );
}
