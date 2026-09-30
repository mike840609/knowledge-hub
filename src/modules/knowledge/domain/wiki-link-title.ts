import { MAX_LINK_TARGET_LENGTH, extractDocumentLinks } from "./document-links";
import { buildLinkResolver, stripMarkdownExtension } from "./link-resolution";

const writable = new Map<string, boolean>();

/**
 * Whether `[[title]]`, written on its own, is a link that resolves back to a document with that title.
 * Asked of the real extractor and the real resolver, not of a list of characters to avoid: a title
 * holding `|` or `#` is read as an alias or a heading, one with `/` as a path, one ending `.md` loses
 * its ending, and Markdown syntax inside (`*`, `` ` ``, `<`) can split the text so that no link is
 * found at all. Any of those would be written as a link that goes somewhere else, or nowhere.
 *
 * It answers for a Hub document, which has no path of its own to be found by, and for a Workspace
 * holding no other document of that title: what happens among several is the resolver's rule.
 */
export function isWritableAsWikiLink(title: string): boolean {
  const cached = writable.get(title);
  if (cached !== undefined) return cached;
  let result = false;
  if (title.trim() !== "" && !/[\n\r]/.test(title)) {
    const links = extractDocumentLinks(`[[${title.trim()}]]`);
    const only = links.length === 1 ? links[0] : null;
    if (only && only.kind === "WIKI" && only.fragment === null && only.display === null) {
      const alone = { documentId: "self", sourceId: "s", title, sourcePath: null, createdAt: new Date(0) };
      const resolution = buildLinkResolver([alone]).resolve(only, { documentId: "here", sourceId: "s", sourcePath: null });
      result = resolution.status === "RESOLVED" && resolution.documentId === "self";
    }
  }
  // A workspace has a few thousand titles at most; the cache is a cost saved, not a store to grow.
  if (writable.size > 20_000) writable.clear();
  writable.set(title, result);
  return result;
}

/**
 * The title a new document has to be given for a `[[target]]` written somewhere to resolve to it, or
 * `null` when no title can do that (`[[a/b]]` names a path, and a Hub document has none). The target
 * is a wikilink's, as `extractDocumentLinks` reports it: `.md` ending and all, which the resolver
 * ignores, so the title leaves it off.
 */
export function titleForNewDocument(target: string): string | null {
  const written = stripMarkdownExtension(target.trim());
  if (written === "" || written.length > MAX_LINK_TARGET_LENGTH) return null;
  return isWritableAsWikiLink(written) ? written : null;
}
