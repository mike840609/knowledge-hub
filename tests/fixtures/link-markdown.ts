/**
 * Markdown that says something about links, with the links it says.
 *
 * Two suites read this list, and that is the point of it:
 *
 * - `document-links-extract.test.ts` asserts that `extractDocumentLinks(markdown)` finds
 *   exactly `links` — the extractor's rule table.
 * - `editor-wikilinks.test.ts` asserts that the rendered editor gives back Markdown with the
 *   same links after opening it and after editing next to them. Whatever the extractor
 *   counts as a link, the editor must not lose; whatever it does not count as one
 *   (a `\[\[x\]\]` the author escaped, `[[x]]` in code), the editor must not turn into one.
 *
 * So the rule table is the editor's specification, and the two cannot drift apart: a new
 * rule goes in here once and both suites pick it up.
 */
export type ExpectedLink = {
  kind: "WIKI" | "PATH";
  target: string;
  fragment: string | null;
  /** The alias of a wikilink, or the text of a Markdown link. */
  display: string | null;
};

export type LinkMarkdownFixture = {
  name: string;
  markdown: string;
  /** In reading order. */
  links: ExpectedLink[];
};

const wiki = (target: string, fragment: string | null = null, display: string | null = null): ExpectedLink => ({ kind: "WIKI", target, fragment, display });
const path = (target: string, fragment: string | null, display: string): ExpectedLink => ({ kind: "PATH", target, fragment, display });

export const LINK_MARKDOWN_FIXTURES: LinkMarkdownFixture[] = [
  // --- wikilinks in their forms
  { name: "a wikilink in a sentence", markdown: "See [[Target Note]] for details.\n", links: [wiki("Target Note")] },
  { name: "a wikilink with an alias", markdown: "[[Note|alias]]\n", links: [wiki("Note", null, "alias")] },
  { name: "a wikilink to a heading", markdown: "[[Note#Setup]]\n", links: [wiki("Note", "Setup")] },
  {
    name: "wikilinks in every form",
    markdown: "See [[Alpha]], [[Beta|the beta]], [[Gamma#Setup]] and [[Delta#Setup|d]].",
    links: [wiki("Alpha"), wiki("Beta", null, "the beta"), wiki("Gamma", "Setup"), wiki("Delta", "Setup", "d")],
  },
  { name: "path-qualified and non-Latin names", markdown: "[[Notes/Source]] and [[請假流程]]", links: [wiki("Notes/Source"), wiki("請假流程")] },
  { name: "a block id is dropped and the link kept", markdown: "[[Note#^abc123]]\n", links: [wiki("Note")] },
  { name: "spaces around the parts are trimmed", markdown: "[[  Spaced  #  Head  |  shown  ]]\n", links: [wiki("Spaced", "Head", "shown")] },
  { name: "adjacent wikilinks", markdown: "[[A]][[B]]\n", links: [wiki("A"), wiki("B")] },

  // --- relative Markdown links
  {
    name: "relative Markdown links, inline and by reference",
    markdown: "[b](../b.md) and [c][ref] and [d](<My Note.md>)\n\n[ref]: c.md#top\n",
    links: [path("../b.md", null, "b"), path("c.md", "top", "c"), path("My Note.md", null, "d")],
  },
  { name: "a relative link with a fragment", markdown: "[the setup](./setup.md#local)\n", links: [path("./setup.md", "local", "the setup")] },
  {
    name: "a wikilink and a relative link, in reading order",
    markdown: "[[One]] then [two](two.md) then [[Three]]",
    links: [wiki("One"), path("two.md", null, "two"), wiki("Three")],
  },

  // --- where a wikilink lives
  { name: "a wikilink in a list item", markdown: "- item with [[Item Link]]\n", links: [wiki("Item Link")] },
  { name: "a wikilink in an ordered list item", markdown: "1. one [[X]]\n", links: [wiki("X")] },
  { name: "a wikilink in a task list item", markdown: "- [ ] task [[X]]\n", links: [wiki("X")] },
  {
    name: "wikilinks in tables, lists, quotes and headings",
    markdown: ["| a | b |", "| - | - |", "| [[InTable]] | x |", "", "- [[InList]]", "", "> [[InQuote]]", "", "## About [[InHeading]]"].join("\n"),
    links: [wiki("InTable"), wiki("InList"), wiki("InQuote"), wiki("InHeading")],
  },
  { name: "a wikilink in bold", markdown: "**bold [[Inside Bold]] text**\n", links: [wiki("Inside Bold")] },
  { name: "a wikilink in italics", markdown: "_em [[Inside Em]] text_\n", links: [wiki("Inside Em")] },
  { name: "wikilinks after a soft break", markdown: "line one [[A]]\nline two [[B]]\n", links: [wiki("A"), wiki("B")] },
  { name: "a wikilink after a hard break", markdown: "a\\\n[[X]]\n", links: [wiki("X")] },
  { name: "a wikilink after an image", markdown: "![a](/a.png) [[X]]\n", links: [wiki("X")] },
  { name: "a wikilink after an entity", markdown: "Q&amp;A [[Note]]\n", links: [wiki("Note")] },

  // --- a pipe is the cell separator in a table, so the alias's pipe is written escaped there
  {
    name: "an escaped pipe in a table cell is the alias separator",
    markdown: ["| a |", "| - |", "| [[Note\\|shown]] |"].join("\n"),
    links: [wiki("Note", null, "shown")],
  },
  {
    name: "two aliased wikilinks in table cells",
    markdown: "| a | b |\n| - | - |\n| [[N\\|s]] | [[M#H\\|t]] |\n",
    links: [wiki("N", null, "s"), wiki("M", "H", "t")],
  },

  // --- what is not a link
  { name: "embeds are not links", markdown: "![[Image.png]] and ![[Other note]] but [[Real]]", links: [wiki("Real")] },
  {
    name: "brackets that are shown, not written",
    markdown: ["`[[inline]]`", "", "```", "[[fenced]]", "```", "", "    [[indented]]", "", "<div>[[html]]</div>", "", "kept [[Real]]"].join("\n"),
    links: [wiki("Real")],
  },
  { name: "an escaped wikilink is not a link", markdown: "\\[\\[literal\\]\\] and [[Real]]", links: [wiki("Real")] },
  // Milkdown's `text` handler leaves text that ends in a space unescaped, so these two put an
  // escaped `[[` next to something that ends the text with a space.
  // The first constrains the editor only: the extractor's cheap pre-check needs a literal `[[` and
  // finds none in `\[\[`, so it returns nothing here without parsing (mutating `findWikiLinks`'s
  // escape handling leaves this case green; it is the second one that catches that).
  { name: "an escaped wikilink before an image is not a link", markdown: "\\[\\[lit\\]\\] and ![a](/a.png)\n", links: [] },
  { name: "an escaped wikilink between two wikilinks is not a link", markdown: "[[A]] \\[\\[lit\\]\\] [[B]]\n", links: [wiki("A"), wiki("B")] },
  {
    name: "links that are not to another document",
    markdown: "[site](https://example.com/a.md) [pic](img.png) [anchor](#part) [pdf](a.pdf) <https://example.com>",
    links: [],
  },
  { name: "the text of a link is not a second link", markdown: "[see [[Inner]]](outer.md)", links: [path("outer.md", null, "see [[Inner]]")] },
  { name: "a wikilink does not span lines or nest", markdown: "[[broken\nlink]] and [[a [[b]] c]]", links: [wiki("b")] },
  { name: "a wikilink split by emphasis is not a link (documented limit)", markdown: "[[*starred*]]", links: [] },
];

/** One fixture by name, for a test that needs the Markdown of a case and says so. */
export function linkFixture(name: string): LinkMarkdownFixture {
  const found = LINK_MARKDOWN_FIXTURES.find((fixture) => fixture.name === name);
  if (!found) throw new Error(`No link fixture named "${name}"`);
  return found;
}
