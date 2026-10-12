import { Info, Lightbulb, MessageSquareWarning, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { CALLOUT_ATTRIBUTE, type CalloutKind } from "@/shared/markdown/remark-callouts";

/**
 * Only the line and the glyph are coloured, from the semantic tokens; the title and the body are
 * read in the text colour (design language §8, "Callouts"). There is no colour for information or
 * for emphasis, so a note and an important are neutral and told apart by their glyph and word.
 */
const CALLOUTS: Record<CalloutKind, { title: string; Icon: LucideIcon; line: string; glyph: string }> = {
  note: { title: "Note", Icon: Info, line: "border-kh-border-strong", glyph: "text-kh-text-muted" },
  tip: { title: "Tip", Icon: Lightbulb, line: "border-kh-success", glyph: "text-kh-success" },
  important: { title: "Important", Icon: MessageSquareWarning, line: "border-kh-text-secondary", glyph: "text-kh-text" },
  warning: { title: "Warning", Icon: TriangleAlert, line: "border-kh-warning", glyph: "text-kh-warning" },
  caution: { title: "Caution", Icon: OctagonAlert, line: "border-kh-danger", glyph: "text-kh-danger" },
};

/**
 * A quote, or — where `remarkCallouts` marked it — a callout: the quote's line, a title that says
 * its kind, and the body unmuted. Not a `<blockquote>`: nobody is being quoted.
 */
export function MarkdownQuote(props: { children?: ReactNode; [CALLOUT_ATTRIBUTE]?: string }) {
  const callout = CALLOUTS[props[CALLOUT_ATTRIBUTE] as CalloutKind];
  if (!callout) return <blockquote>{props.children}</blockquote>;
  const { title, Icon, line, glyph } = callout;
  // The body's first block sits close under the title it belongs to, not a paragraph's distance away.
  return (
    <div role="note" data-callout={props[CALLOUT_ATTRIBUTE]} className={`my-3 border-l-2 pl-4 text-kh-text [&>:nth-child(2)]:mt-1 ${line}`}>
      <div className="flex items-center gap-2 font-medium">
        <Icon aria-hidden="true" className={`h-4 w-4 shrink-0 ${glyph}`} />
        {title}
      </div>
      {props.children}
    </div>
  );
}
