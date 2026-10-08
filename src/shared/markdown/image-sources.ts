import type { Definition, Image, ImageReference } from "mdast";
import { visit } from "unist-util-visit";
import { parseMarkdown } from "./parse";

/** Every image source a Markdown body draws, parsed as the renderer parses it. */
export function extractImageSources(markdown: string): string[] {
  const tree = parseMarkdown(markdown);
  const definitions = new Map<string, string>();
  visit(tree, "definition", (node: Definition) => { definitions.set(node.identifier, node.url); });
  const sources = new Set<string>();
  visit(tree, (node) => {
    if (node.type === "image") sources.add((node as Image).url);
    if (node.type === "imageReference") {
      const url = definitions.get((node as ImageReference).identifier);
      if (url) sources.add(url);
    }
  });
  return [...sources].filter(Boolean);
}
