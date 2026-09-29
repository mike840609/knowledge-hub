// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkdownEditor, parsedIntact, type EditorOptions, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";

const opened: MarkdownEditor[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.destroy();
  document.body.innerHTML = "";
});

async function open(markdown: string, overrides: Partial<EditorOptions> = {}) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const calls = { edits: 0, markdown: [] as string[] };
  const editor = await createMarkdownEditor({
    root,
    markdown,
    className: "kh-editor",
    ariaLabel: "Content",
    editable: true,
    onUserEdit: () => { calls.edits += 1; },
    onMarkdown: (next) => { calls.markdown.push(next); },
    allowImage: (src) => src.startsWith("/"),
    ...overrides,
  });
  opened.push(editor);
  return { root, editor, calls };
}

/** What typing does to the document: one transaction that changes it. */
function type(editor: MarkdownEditor, text: string) {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.insertText(text, 1));
  });
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

// Written as inputs and outputs, so the list is the documentation of what the
// editor rewrites on the first edit (composer spec §11.8) and a regression guard.
const unchanged: Record<string, string> = {
  "heading and paragraph": "# Title\n\nSome text with **bold**, _emphasis_ and `code`.\n",
  "dash list, nested": "- one\n- two\n  - nested\n",
  "ordered list": "1. a\n2. b\n3. c\n",
  "task list": "- [ ] todo\n- [x] done\n",
  "code fence with language": "```ts\nconst a = 1;\n```\n",
  "link": "[site](https://example.com)\n",
  "link with title": "[site](https://example.com \"the title\")\n",
  "autolink": "<https://example.com>\n",
  "image": "![alt text](/a.png)\n",
  "image with title": "![alt](/a.png \"cap\")\n",
  "image inside a paragraph": "text ![alt](/a.png) more\n",
  "blockquote": "> quoted\n> more\n",
  "rule": "before\n\n---\n\nafter\n",
  "html block": "<div class=\"note\">hello</div>\n\nafter\n",
  "inline html": "text <kbd>Ctrl</kbd> more\n",
  "footnote": "text[^1]\n\n[^1]: the note\n",
  "CJK text": "# 標題\n\n這是**粗體**，還有`程式碼`。\n",
};
const rewritten: Record<string, [input: string, output: string]> = {
  "star list becomes dash": ["* one\n* two\n", "- one\n- two\n"],
  "table separator is shortened": ["| a | b |\n|---|---|\n| 1 | 2 |\n", "| a | b |\n| - | - |\n| 1 | 2 |\n"],
  "two trailing spaces become a backslash break": ["line one  \nline two\n", "line one\\\nline two\n"],
  "setext heading becomes ATX": ["Title\n=====\n\ntext\n", "# Title\n\ntext\n"],
  "a redundant escape is dropped": ["a and 1\\. not a list\n", "a and 1. not a list\n"],
  "a star rule becomes dashes": ["a\n\n***\n\nb\n", "a\n\n---\n\nb\n"],
  "a wikilink is escaped": ["see [[Other Page]] here\n", "see \\[\\[Other Page]] here\n"],
  // mdast-util-to-markdown 2.1.2 (the locked version) escapes every underscore in text; 2.1.3 keeps one between two letters (與_斜體\_，).
  "underscores in text are escaped, including one between CJK letters": ["與_斜體_，\n", "與\\_斜體\\_，\n"],
};

describe("Markdown round trip through the editor", () => {
  it.each(Object.entries(unchanged))("leaves %s as it was", async (_name, markdown) => {
    const { editor } = await open(markdown);
    expect(editor.getMarkdown()).toBe(markdown);
  });

  it.each(Object.entries(rewritten))("%s", async (_name, [input, output]) => {
    const { editor } = await open(input);
    expect(editor.getMarkdown()).toBe(output);
  });

  it("opens an image that has no title (Milkdown 7.22 throws on it without the patch)", async () => {
    const { editor } = await open("intro\n\n![no title](/a.png)\n\noutro\n");
    expect(editor.getMarkdown()).toBe("intro\n\n![no title](/a.png)\n\noutro\n");
  });
});

describe("parsedIntact", () => {
  it("rejects only an empty output from a non-empty document", () => {
    expect(parsedIntact("# Title\n", "")).toBe(false);
    expect(parsedIntact("# Title\n", "  \n")).toBe(false);
    expect(parsedIntact("# Title\n", "# Title\n")).toBe(true);
    expect(parsedIntact("", "")).toBe(true);
    expect(parsedIntact("  \n", "")).toBe(true);
  });
});

describe("images follow the reader's policy", () => {
  it("gives a refused source an empty src, keeps an allowed one, and never edits the document", async () => {
    const markdown = "![x](https://evil.example/a.png) ![y](/ok.png)\n";
    const { root, editor } = await open(markdown);
    const sources = [...root.querySelectorAll("img")].map((image) => image.getAttribute("src")).filter((src) => src !== null);
    expect(sources).toEqual(["", "/ok.png"]);
    expect(editor.getMarkdown()).toBe(markdown);
  });
});

describe("what counts as an edit", () => {
  it("is nothing at open, and typing the moment it happens", async () => {
    const { editor, calls } = await open("# T\n\ntext\n");
    await settle();
    expect(calls.edits).toBe(0);
    expect(calls.markdown).toEqual([]);
    type(editor, "Z");
    expect(calls.edits).toBe(1);
  });

  it("is not a caret move or a focus", async () => {
    const { editor, calls } = await open("# T\n\ntext\n");
    editor.focusStart();
    await settle();
    expect(calls.edits).toBe(0);
  });

  it("is not replacing the whole document, which also emits no Markdown", async () => {
    const { editor, calls } = await open("# T\n");
    editor.replaceMarkdown("# New\n\nreplaced\n");
    await settle();
    expect(calls.edits).toBe(0);
    expect(calls.markdown).toEqual([]);
    expect(editor.getMarkdown()).toBe("# New\n\nreplaced\n");
  });
});

describe("output", () => {
  it("is debounced after a change, and always available right away", async () => {
    const { editor, calls } = await open("# T\n");
    type(editor, "Z");
    expect(calls.markdown).toEqual([]);
    expect(editor.getMarkdown()).toBe("# ZT\n");
    await settle();
    expect(calls.markdown).toEqual(["# ZT\n"]);
  });
});

describe("the editable element", () => {
  it("carries the classes and the name it was given, and can be locked and unlocked", async () => {
    const { root, editor } = await open("text\n", { editable: false });
    const element = root.querySelector(".ProseMirror");
    expect(element?.classList.contains("kh-editor")).toBe(true);
    expect(element?.getAttribute("aria-label")).toBe("Content");
    expect(element?.getAttribute("role")).toBe("textbox");
    expect(element?.getAttribute("contenteditable")).toBe("false");
    editor.setEditable(true);
    expect(element?.getAttribute("contenteditable")).toBe("true");
  });
});
