import type { LinkTargetView } from "@/modules/knowledge/application/knowledge-link-service";
import { extractDocumentLinks } from "@/modules/knowledge/domain/document-links";
import { buildLinkResolver, normalizeLinkKey } from "@/modules/knowledge/domain/link-resolution";

/**
 * What the `[[` list offers and how it is put in order (daily-driver spec §6.1). Pure: the editor
 * plugin asks it two questions — is the caret in the middle of writing a link (`findWikiLinkTrigger`),
 * and which documents fit what was typed (`rankSuggestions`) — and does the editing itself.
 */

/** A query longer than this is a paragraph that happens to follow a `[[`, not a name someone is looking for. */
export const MAX_QUERY_LENGTH = 100;

/** How many suggestions the list shows. */
export const SUGGESTION_LIMIT = 8;

export type WikiLinkTrigger = {
  /** Where the `[[` starts, as an offset into the text given. */
  from: number;
  /** What was typed after it. */
  query: string;
};

/**
 * The link being written at the end of `textBefore` (the text of the caret's block, up to the caret),
 * or `null` when there is none: `[[` and then a query with no `]`, `[`, `|`, `#` or line break in it.
 *
 * `|` and `#` end it because they say the name is chosen and what follows is an alias or a heading,
 * which no document list can complete. A backslash before the brackets is an escape, and a `!` is
 * an embed — neither is a link (`findWikiLinks`), so neither offers to complete one.
 */
export function findWikiLinkTrigger(textBefore: string): WikiLinkTrigger | null {
  const open = textBefore.lastIndexOf("[[");
  if (open === -1) return null;
  const before = textBefore[open - 1];
  if (before === "\\" || before === "!") return null;
  const query = textBefore.slice(open + 2);
  if (query.length > MAX_QUERY_LENGTH || /[\]\[|#\n\r]/.test(query)) return null;
  return { from: open, query };
}

const KEYS = new WeakMap<LinkTargetView, { match: string; resolves: string }>();
const writable = new Map<string, boolean>();

/**
 * How a title is compared with what was typed. The resolver's own `normalizeLinkKey`, after a
 * compatibility fold so that full-width letters and digits, which a Chinese input method produces
 * without anyone asking, find the ordinary ones. That is looser than resolution — `[[Ｋube]]` does
 * not resolve to `Kube` — and safe, because a suggestion writes its own title, never what was typed.
 */
function matchKey(value: string): string {
  return normalizeLinkKey(value.normalize("NFKC"));
}

/** Both keys of a target, worked out once: the list is the same array between one keystroke and the next. */
function keysOf(target: LinkTargetView): { match: string; resolves: string } {
  let keys = KEYS.get(target);
  if (keys === undefined) {
    keys = { match: matchKey(target.title), resolves: normalizeLinkKey(target.title) };
    KEYS.set(target, keys);
  }
  return keys;
}

/**
 * Whether `[[title]]` written on its own is a link that resolves back to a document with that title.
 * Asked of the real extractor and the real resolver, not of a list of characters to avoid: a title
 * holding `|` or `#` is read as an alias or a heading, one with `/` as a path, one ending `.md` loses
 * its ending, and Markdown syntax inside (`*`, `` ` ``, `<`) can split the text so that no link is
 * found at all. Any of those would be inserted as a link that goes somewhere else, or nowhere.
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

export type Suggestion = {
  target: LinkTargetView;
  /** The link as it is written into the document. */
  link: string;
  /** How many other documents in the list have a title the resolver takes for the same, so the list can say which one this is. */
  sameTitle: number;
};

/** Newest edit first; the key and the id only so that the same list always comes out in the same order. */
function byRecency(left: LinkTargetView, right: LinkTargetView): number {
  if (left.editedAt !== right.editedAt) return left.editedAt < right.editedAt ? 1 : -1;
  const leftKey = keysOf(left).match;
  const rightKey = keysOf(right).match;
  if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
  return left.documentId < right.documentId ? -1 : left.documentId > right.documentId ? 1 : 0;
}

/**
 * The documents that fit `query`, best first: a title that is the query, then one that starts with
 * it, then one that contains it; within each, the most recently edited. An empty query is every
 * document, newest first. A document whose title cannot be written as a link is not offered
 * (`isWritableAsWikiLink`), so what is picked is what the link resolves to.
 *
 * Titles two documents share are both offered, told apart by their Source (`sameTitle`); which one
 * `[[Title]]` then opens is the resolver's rule, not this list's.
 */
export function rankSuggestions(targets: readonly LinkTargetView[], query: string, limit = SUGGESTION_LIMIT): Suggestion[] {
  const wanted = matchKey(query);
  const tiers: LinkTargetView[][] = [[], [], []];
  const titles = new Map<string, number>();
  for (const target of targets) {
    const { match: key, resolves } = keysOf(target);
    titles.set(resolves, (titles.get(resolves) ?? 0) + 1);
    if (wanted === "") tiers[2].push(target);
    else if (key === wanted) tiers[0].push(target);
    else if (key.startsWith(wanted)) tiers[1].push(target);
    else if (key.includes(wanted)) tiers[2].push(target);
  }
  const suggestions: Suggestion[] = [];
  for (const tier of tiers) {
    tier.sort(byRecency);
    for (const target of tier) {
      if (suggestions.length >= limit) return suggestions;
      if (!isWritableAsWikiLink(target.title)) continue;
      suggestions.push({ target, link: `[[${target.title.trim()}]]`, sameTitle: (titles.get(keysOf(target).resolves) ?? 1) - 1 });
    }
  }
  return suggestions;
}
