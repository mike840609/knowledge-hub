import type { Blockquote, Paragraph, Root, Text } from "mdast";
import type {} from "mdast-util-to-hast";
import { visit } from "unist-util-visit";

export const CALLOUT_KINDS = ["note", "tip", "important", "warning", "caution"] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

/** The attribute the plugin puts on the quote and the renderer reads back. */
export const CALLOUT_ATTRIBUTE = "data-callout";

// The marker and nothing else on its line.
const MARKER = new RegExp(`^\\[!(${CALLOUT_KINDS.join("|")})\\][ \\t]*(?:\\n|$)`, "i");

const MARKER_LINE = new RegExp(`^\\[!(${CALLOUT_KINDS.join("|")})\\][ \\t]*$`, "i");

/** The kind a line names, when it is the marker and nothing else. For the editor, which holds a quote's lines apart. */
export function calloutKind(line: string): CalloutKind | null {
  return (MARKER_LINE.exec(line)?.[1].toLowerCase() as CalloutKind | undefined) ?? null;
}

/**
 * The marker a quote opens with, when it is one: its kind, and the text of it that is taken out of
 * what is shown. A marker is `[!NOTE]` (or another kind) alone on the quote's first line.
 */
export function calloutMarker(quote: Blockquote): { kind: CalloutKind; text: string } | null {
  const paragraph = quote.children[0];
  const first = paragraph?.type === "paragraph" ? paragraph.children[0] : undefined;
  if (paragraph?.type !== "paragraph" || first?.type !== "text") return null;
  const match = MARKER.exec(first.value);
  if (!match) return null;
  // The text ran out with the marker: what follows in the paragraph is on the same line unless it is a break.
  const next = paragraph.children[1];
  if (!match[0].endsWith("\n") && next && next.type !== "break") return null;
  return { kind: match[1].toLowerCase() as CalloutKind, text: match[0] };
}

/**
 * Marks a quote that opens with `[!NOTE]` (or `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`) alone on
 * its first line as a callout of that kind, and takes the marker out of what is shown. How it is
 * drawn is the renderer's (`markdown-callout.tsx`).
 *
 * It reads the parsed text, so `\[!NOTE]` — which is how the editor writes the marker back — is the
 * same marker. That is on purpose, and is where this parts from GitHub: a callout must not stop
 * being one because its document was saved.
 */
export function remarkCallouts() {
  return (tree: Root) => {
    visit(tree, "blockquote", (quote) => {
      const marker = calloutMarker(quote);
      if (!marker) return;
      const paragraph = quote.children[0] as Paragraph, first = paragraph.children[0] as Text;
      first.value = first.value.slice(marker.text.length);
      if (first.value === "") paragraph.children.splice(0, marker.text.endsWith("\n") ? 1 : 2);
      if (paragraph.children.length === 0) quote.children.shift();
      quote.data = { ...quote.data, hProperties: { ...quote.data?.hProperties, [CALLOUT_ATTRIBUTE]: marker.kind } };
    });
  };
}
