// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { extractDocumentLinks } from "@/modules/knowledge/domain/document-links";
import { LINK_MARKDOWN_FIXTURES } from "../fixtures/link-markdown";

/**
 * The rendered editor must give back Markdown with the links it was given.
 *
 * Until the wikilink became a node of its own the editor wrote `[[x]]` back as `\[\[x]]`: a
 * document opened and saved from it lost every wikilink (the link index went from 1 to 0, and
 * every backlink and graph edge with it), and nothing noticed because no test read the links a
 * saved document holds. This one does, for every case the extractor's rule table has
 * (`tests/fixtures/link-markdown.ts`) — so what the extractor counts as a link, the editor keeps,
 * and what it does not count as one (an escaped `\[\[x\]\]`, code, an embed), the editor does not
 * turn into one.
 */

const opened: MarkdownEditor[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.destroy();
  document.body.innerHTML = "";
});

async function open(markdown: string) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const editor = await createMarkdownEditor({
    root,
    markdown,
    className: "kh-editor",
    ariaLabel: "Content",
    editable: true,
    onUserEdit: () => {},
    onMarkdown: () => {},
    allowImage: () => true,
  });
  opened.push(editor);
  return editor;
}

const view = (editor: MarkdownEditor) => editor.action((ctx) => ctx.get(editorViewCtx));

/** What a saved document's link index would hold, without the line numbers (the editor re-flows lines). */
const links = (markdown: string) => extractDocumentLinks(markdown).map(({ kind, target, fragment, display }) => ({ kind, target, fragment, display }));

/** Where each wiki_link node starts and ends. */
function wikiLinkSpans(editor: MarkdownEditor): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  view(editor).state.doc.descendants((node, position) => {
    if (node.type.name === "wiki_link") spans.push({ start: position, end: position + node.nodeSize });
  });
  return spans;
}

describe("the rendered editor keeps the links of a document", () => {
  it("has the fixtures it is meant to be held to", () => {
    // A guard against this file going quiet: the list is the specification.
    expect(LINK_MARKDOWN_FIXTURES.length).toBeGreaterThanOrEqual(30);
    expect(LINK_MARKDOWN_FIXTURES.filter((fixture) => fixture.links.some((link) => link.kind === "WIKI")).length).toBeGreaterThanOrEqual(25);
  });

  describe.each(LINK_MARKDOWN_FIXTURES)("$name", ({ markdown, links: expected }) => {
    it("gives back the links it was given, having only been opened", async () => {
      const editor = await open(markdown);
      expect(links(editor.getMarkdown())).toEqual(expected);
    });

    it("holds each wikilink as a node, and nothing else as one", async () => {
      const editor = await open(markdown);
      expect(wikiLinkSpans(editor)).toHaveLength(expected.filter((link) => link.kind === "WIKI").length);
    });

    it("still has them after a paragraph is added above", async () => {
      const editor = await open(markdown);
      const v = view(editor);
      v.dispatch(v.state.tr.insert(0, v.state.schema.nodes.paragraph.create(null, v.state.schema.text("Z"))));
      expect(links(editor.getMarkdown())).toEqual(expected);
    });

    it("still has them after text is typed right before and right after a wikilink", async () => {
      const editor = await open(markdown);
      const v = view(editor);
      // From the last to the first, so earlier positions stay where they were.
      for (const { start, end } of wikiLinkSpans(editor).reverse()) {
        v.dispatch(v.state.tr.insertText("Z", end));
        v.dispatch(v.state.tr.insertText("Y", start));
      }
      expect(links(editor.getMarkdown())).toEqual(expected);
    });
  });
});

describe("what a wikilink is written back as", () => {
  // The Markdown a person reads in the source view: the link as it was written, not a rewrite of it.
  it.each([
    ["a link", "See [[Target Note]] for details.\n"],
    ["an alias", "[[Note|alias]]\n"],
    ["a heading", "[[Note#Setup]]\n"],
    ["a heading and an alias", "[[Note#Setup|shown]]\n"],
    ["a link in a list", "- item with [[Item Link]]\n"],
    ["a link in bold", "**bold [[Inside Bold]] text**\n"],
    ["a link in a table cell, with its alias's pipe escaped", "| a                   |\n| ------------------- |\n| [[Note\\|shown]] |\n"],
  ])("%s", async (_name, markdown) => {
    const editor = await open(markdown);
    const written = editor.getMarkdown();
    expect(written).not.toContain("\\[");
    for (const link of markdown.match(/\[\[[^\]]+\]\]/g) ?? []) expect(written).toContain(link);
  });

  it("keeps an escaped wikilink escaped, and does not let the text before a real one lose the escape", async () => {
    const editor = await open("\\[\\[lit\\]\\] and [[Real]]\n");
    expect(editor.getMarkdown()).toBe("\\[\\[lit]] and [[Real]]\n");
  });
});
