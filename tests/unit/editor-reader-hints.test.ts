// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";

const opened: MarkdownEditor[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.destroy();
  document.body.innerHTML = "";
});

async function open(markdown: string) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const editor = await createMarkdownEditor({ root, markdown, className: "kh-editor", ariaLabel: "Content", editable: true, onUserEdit: () => {}, onMarkdown: () => {}, allowImage: () => true });
  opened.push(editor);
  return { root, editor };
}
/** Types `text` right after the first occurrence of `after`. */
function typeAfter(editor: MarkdownEditor, after: string, text: string) {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    let at = 0;
    view.state.doc.descendants((node, pos) => {
      const index = node.isText ? (node.text ?? "").indexOf(after) : -1;
      if (!at && index >= 0) at = pos + index + after.length;
    });
    view.dispatch(view.state.tr.insertText(text, at));
  });
}
const callout = (root: HTMLElement) => root.querySelector("blockquote")?.getAttribute("data-callout") ?? null;

/**
 * The editor shows what the reader will make of a callout and of the HTML subset, without holding
 * either as anything but the text it is: the marker and the tags stay, and the Markdown it writes
 * is what it wrote before (docs/superpowers/specs/2026-10-12-editor-reader-hints-design.md).
 */
describe("the reader's look, hinted in the editor", () => {
  it("keeps heading anchors unique and updates them without changing Markdown", async () => {
    const markdown = "## Setup\n\n## Setup\n\n## 請假流程\n";
    const { root, editor } = await open(markdown);
    expect([...root.querySelectorAll("h2")].map(node => node.id)).toEqual(["setup", "setup-1", "請假流程"]);
    expect(editor.getMarkdown()).toBe(markdown);
    typeAfter(editor, "Setup", " changed");
    expect([...root.querySelectorAll("h2")].map(node => node.id)).toEqual(["setup-changed", "setup", "請假流程"]);
  });

  describe("a callout", () => {
    it.each([["NOTE", "note"], ["TIP", "tip"], ["IMPORTANT", "important"], ["WARNING", "warning"], ["CAUTION", "caution"]])("marks a quote that opens with [!%s]", async (marker, kind) => {
      const { root } = await open(`> [!${marker}]\n> body\n`);
      expect(callout(root)).toBe(kind);
    });

    it.each([
      ["in lower case", "> [!note]\n> body\n"],
      ["escaped, as the editor itself writes it", "> \\[!NOTE]\n> body\n"],
      ["with nothing after it", "> [!NOTE]\n"],
      ["with the body in a paragraph of its own", "> [!NOTE]\n>\n> body\n"],
    ])("reads the marker %s", async (_name, markdown) => {
      expect(callout((await open(markdown)).root)).toBe("note");
    });

    it.each([
      ["an unknown kind", "> [!FOO]\n> body\n"],
      ["text after the marker on its line", "> [!NOTE] body\n"],
      ["a marker that is not the first line", "> body\n> [!NOTE]\n"],
      ["a plain quote", "> body\n"],
    ])("leaves %s a quote", async (_name, markdown) => {
      expect(callout((await open(markdown)).root)).toBeNull();
    });

    it("keeps the marker where it is, to be read and edited", async () => {
      const { root } = await open("> [!NOTE]\n> body\n");
      expect(root.querySelector("blockquote")?.textContent).toContain("[!NOTE]");
    });

    it("follows the typing: it is a callout from the keystroke that makes it one, and until the one that unmakes it", async () => {
      const { root, editor } = await open("> [!NOT]\n> body\n");
      expect(callout(root)).toBeNull();
      typeAfter(editor, "[!NOT", "E");
      expect(callout(root)).toBe("note");
      typeAfter(editor, "[!NOTE]", " now text");
      expect(callout(root)).toBeNull();
    });
  });

  describe("the inline HTML subset", () => {
    it.each([["u"], ["sub"], ["sup"], ["kbd"], ["mark"]])("draws what is between <%s> and its closing tag as the reader will", async (tag) => {
      const { root } = await open(`a <${tag}>b</${tag}> c\n`);
      expect(root.querySelector(tag)?.textContent).toBe("b");
    });

    it("keeps the tags where they are, as the text they are, and marks them as tags", async () => {
      const { root } = await open("a <u>b</u> c\n");
      const written = [...root.querySelectorAll('span[data-type="html"]')];
      expect(written.map((node) => node.textContent)).toEqual(["<u>", "</u>"]);
      expect(written.every((node) => node.classList.contains("kh-html-tag"))).toBe(true);
      expect(root.querySelector("p")?.textContent).toBe("a <u>b</u> c");
    });

    it("draws one inside another", async () => {
      const { root } = await open("H<sub>2<sup>x</sup></sub>O\n");
      expect(root.querySelector("sub")?.textContent).toContain("2");
      expect(root.querySelector("sup")?.textContent).toBe("x");
    });

    it.each([
      ["a tag that is never closed", "a <u>b c\n", "u"],
      ["a closing tag with nothing open", "a b</u> c\n", "u"],
      ["a tag with an attribute", 'a <u class="x">b</u> c\n', "u"],
      ["a tag outside the subset", "a <span>b</span> c\n", "span:not([data-type])"],
      ["a pair across two paragraphs", "a <u>b\n\nc</u> d\n", "u"],
    ])("draws nothing for %s", async (_name, markdown, selector) => {
      expect((await open(markdown)).root.querySelector(selector)).toBeNull();
    });

    it("does not mark a tag outside the subset as one of its own", async () => {
      const { root } = await open("a <span>b</span> c\n");
      expect(root.querySelector(".kh-html-tag")).toBeNull();
    });

    it("follows the typing", async () => {
      const { root, editor } = await open("a <u>b c\n");
      expect(root.querySelector("u")).toBeNull();
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const end = view.state.doc.content.size - 1;
        view.dispatch(view.state.tr.insert(end, view.state.schema.nodes.html.create({ value: "</u>" })));
      });
      expect(root.querySelector("u")?.textContent).toBe("b c");
    });
  });

  it.each([
    ["a callout", "> [!NOTE]\n> body\n", "> \\[!NOTE]\n> body\n"],
    ["the HTML subset", "a <u>b</u> and <kbd>k</kbd>\n", "a <u>b</u> and <kbd>k</kbd>\n"],
    ["a <details>", "<details>\n<summary>More</summary>\n\nbody\n\n</details>\n", "<details>\n<summary>More</summary>\n\nbody\n\n</details>\n"],
  ])("writes %s as it did before: the hints are not in the document", async (_name, markdown, written) => {
    expect((await open(markdown)).editor.getMarkdown()).toBe(written);
  });
});
