import type { Definition, Link, LinkReference, Nodes, Root, Text } from "mdast";
import { toString } from "mdast-util-to-string";
import { visit } from "unist-util-visit";
import { parseMarkdown } from "@/shared/markdown/parse";

/**
 * Bumped whenever the syntax rules below change what a given Markdown text
 * yields. The link index records the version it was extracted with, so a
 * changed rule marks every earlier row stale and `db:reindex-document-links`
 * finds them (spec §5, §7.4).
 */
export const LINK_EXTRACTOR_VERSION = 1;

/** Data-volume guards, not semantics: a document that hits them is not a document, it is a dump. */
export const MAX_LINKS_PER_DOCUMENT = 2000;
export const MAX_LINK_TARGET_LENGTH = 512;
export const MAX_LINK_FRAGMENT_LENGTH = 512;
export const MAX_LINK_DISPLAY_LENGTH = 512;

export type LinkKind = "WIKI" | "PATH";

export type ExtractedLink = {
  kind: LinkKind;
  /**
   * WIKI: the name or `path/name` written between the brackets, without
   * `#fragment` or `|alias`. PATH: the decoded relative path, without
   * `#fragment` or `?query`. Never empty.
   */
  target: string;
  /** A heading's text (WIKI) or an anchor (PATH); a `^block` id is dropped. */
  fragment: string | null;
  /** The alias of a WIKI link, or the link text of a PATH link. */
  display: string | null;
  /** 1-based line within the Markdown body, for showing where a backlink sits. */
  line: number;
  /** Order of appearance; unique within a document. */
  ordinal: number;
};

/** `!` right before the brackets makes it an embed, which is not a link (spec §2). */
const WIKI_LINK = /(?<!!)\[\[([^[\]\n]+?)\]\]/g;
const URL_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const MARKDOWN_FILE = /\.(?:md|markdown)$/i;

function truncate(value: string, maxCodePoints: number): string {
  const points = Array.from(value);
  return points.length <= maxCodePoints ? value : points.slice(0, maxCodePoints).join("");
}

function withinLimit(value: string, maxCodePoints: number): boolean {
  // `length` counts UTF-16 units, which is never fewer than code points, so it
  // is a safe cheap rejection before the exact count.
  return value.length <= maxCodePoints || Array.from(value).length <= maxCodePoints;
}

/** `Target#Heading|Alias` → its parts. `null` when there is no target (`[[#Heading]]` is an anchor, not an edge). */
export function parseWikiLinkBody(body: string): { target: string; fragment: string | null; alias: string | null } | null {
  const pipe = body.indexOf("|");
  const left = pipe === -1 ? body : body.slice(0, pipe);
  const alias = pipe === -1 ? null : body.slice(pipe + 1).trim() || null;
  const hash = left.indexOf("#");
  const target = (hash === -1 ? left : left.slice(0, hash)).trim();
  if (target === "") return null;
  const rawFragment = hash === -1 ? "" : left.slice(hash + 1).trim();
  // `#^block-id` addresses a paragraph, which the reader cannot follow; the
  // link still points at the document.
  const fragment = rawFragment === "" || rawFragment.startsWith("^") ? null : rawFragment;
  return { target, fragment, alias };
}

/**
 * The document link a Markdown URL is, or `null` when it is anything else — an
 * external address, an attachment, an image, an in-page anchor. Only a
 * relative path to a Markdown file is a link to another document.
 */
export function parseDocumentHref(url: string): { target: string; fragment: string | null } | null {
  if (url === "" || url.startsWith("#") || url.startsWith("//") || URL_SCHEME.test(url)) return null;
  const hash = url.indexOf("#");
  const beforeFragment = hash === -1 ? url : url.slice(0, hash);
  const rawFragment = hash === -1 ? "" : url.slice(hash + 1);
  const query = beforeFragment.indexOf("?");
  const rawPath = query === -1 ? beforeFragment : beforeFragment.slice(0, query);
  let path = rawPath;
  try {
    path = decodeURI(rawPath);
  } catch {
    // A literal `%` that is not an escape: keep what was written.
  }
  if (!MARKDOWN_FILE.test(path)) return null;
  let fragment: string | null = rawFragment === "" ? null : rawFragment;
  if (fragment !== null) {
    try {
      fragment = decodeURIComponent(fragment);
    } catch {
      // keep as written
    }
  }
  return { target: path, fragment };
}

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;

/**
 * The text a Markdown source span reads as once backslash escapes are
 * resolved, and which characters of it were escaped. The tree keeps only the
 * resolved text, so `\[\[x\]\]` and `[[x]]` look identical there; this is how
 * the two are told apart.
 */
function unescapeWithMask(raw: string): { text: string; escaped: boolean[] } {
  let text = "";
  const escaped: boolean[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] === "\\" && index + 1 < raw.length && ASCII_PUNCTUATION.test(raw[index + 1])) {
      text += raw[index + 1];
      escaped.push(true);
      index += 1;
    } else {
      text += raw[index];
      escaped.push(false);
    }
  }
  return { text, escaped };
}

type Found = { offset: number; link: Omit<ExtractedLink, "ordinal"> };

function collect(markdown: string, tree: Root): Found[] {
  const found: Found[] = [];

  const definitions = new Map<string, string>();
  visit(tree, "definition", (node: Definition) => {
    if (!definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
  });

  const addPathLink = (node: Link | LinkReference, url: string) => {
    const parsed = parseDocumentHref(url);
    if (!parsed || !withinLimit(parsed.target, MAX_LINK_TARGET_LENGTH)) return;
    const display = toString(node).trim();
    found.push({
      offset: node.position?.start.offset ?? 0,
      link: {
        kind: "PATH",
        target: parsed.target,
        fragment: parsed.fragment === null ? null : truncate(parsed.fragment, MAX_LINK_FRAGMENT_LENGTH),
        display: display === "" ? null : truncate(display, MAX_LINK_DISPLAY_LENGTH),
        line: Math.max(1, node.position?.start.line ?? 1),
      },
    });
  };

  visit(tree, "link", (node: Link) => addPathLink(node, node.url));
  visit(tree, "linkReference", (node: LinkReference) => {
    const url = definitions.get(node.identifier);
    if (url !== undefined) addPathLink(node, url);
  });

  const addWikiLinks = (node: Text) => {
    const start = node.position?.start;
    const end = node.position?.end;
    // An escaped `\[\[x\]\]` reaches the tree as `[[x]]`; the source still has the backslashes.
    const raw = start?.offset !== undefined && end?.offset !== undefined ? markdown.slice(start.offset, end.offset) : null;
    let escaped: boolean[] | null = null;
    if (raw !== null) {
      const mask = unescapeWithMask(raw);
      if (mask.text === node.value) escaped = mask.escaped;
      // The span does not read back as the node's text (an entity, a stripped
      // indent), so escapes cannot be located; without a literal `[[` anywhere
      // in it there is nothing here that was written as a link.
      else if (!raw.includes("[[")) return;
    }
    for (const match of node.value.matchAll(WIKI_LINK)) {
      const first = match.index ?? 0;
      const last = first + match[0].length - 1;
      if (escaped && (escaped[first] || escaped[first + 1] || escaped[last] || escaped[last - 1])) continue;
      const parsed = parseWikiLinkBody(match[1]);
      if (!parsed || !withinLimit(parsed.target, MAX_LINK_TARGET_LENGTH)) continue;
      const newlinesBefore = node.value.slice(0, match.index).split("\n").length - 1;
      found.push({
        offset: (start?.offset ?? 0) + (match.index ?? 0),
        link: {
          kind: "WIKI",
          target: parsed.target,
          fragment: parsed.fragment === null ? null : truncate(parsed.fragment, MAX_LINK_FRAGMENT_LENGTH),
          display: parsed.alias === null ? null : truncate(parsed.alias, MAX_LINK_DISPLAY_LENGTH),
          line: Math.max(1, (start?.line ?? 1) + newlinesBefore),
        },
      });
    }
  };

  // Text nodes only: `[[x]]` in a code span or block, or in raw HTML, is
  // being shown, not written as a link. Text already inside a link keeps that
  // link's meaning, so the walk stops descending there.
  const walk = (node: Nodes) => {
    if (node.type === "text") {
      addWikiLinks(node);
      return;
    }
    if (node.type === "link" || node.type === "linkReference") return;
    if ("children" in node) for (const child of node.children) walk(child);
  };
  walk(tree);

  return found;
}

/**
 * Every link to another document written in a Markdown body, in reading
 * order (spec §5). Pure: the same text always yields the same list, and it
 * parses with the configuration the renderer uses, so what is indexed is what
 * a reader sees as a link.
 */
export function extractDocumentLinks(markdown: string): ExtractedLink[] {
  if (!markdown.includes("[")) return [];
  const found = collect(markdown, parseMarkdown(markdown));
  found.sort((left, right) => left.offset - right.offset);
  return found.slice(0, MAX_LINKS_PER_DOCUMENT).map(({ link }, ordinal) => ({ ...link, ordinal }));
}
