// @vitest-environment jsdom
import { editorViewCtx, remarkPluginsCtx, serializerCtx } from "@milkdown/kit/core";
import { listenerCtx } from "@milkdown/kit/plugin/listener";
import { DOMParser as ProseDOMParser, DOMSerializer, type Node as ProseNode } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { createMarkdownEditor, EditorParseError, parsedIntact, type EditorOptions, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { matchesInitial } from "@/lib/composer-output";

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

/** What deleting the just-typed text does: one transaction that changes it back. */
function backspace(editor: MarkdownEditor) {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.delete(1, 2));
  });
}
/** What typing does to the document: one transaction that changes it. */
function type(editor: MarkdownEditor, text: string) {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.insertText(text, 1));
  });
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

/** The document as the clipboard carries it: ProseMirror's schema serialiser into detached HTML. */
function copy(editor: MarkdownEditor): HTMLElement {
  return editor.action((ctx) => {
    const { doc, schema } = ctx.get(editorViewCtx).state;
    const holder = document.createElement("div");
    holder.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(doc.content));
    return holder;
  });
}
/** What paste makes of clipboard HTML: the schema's parser, and the images it found. */
function pastedImages(editor: MarkdownEditor, holder: HTMLElement): ProseNode[] {
  const images: ProseNode[] = [];
  editor.action((ctx) => {
    const parsed = ProseDOMParser.fromSchema(ctx.get(editorViewCtx).state.schema).parse(holder);
    parsed.descendants((node) => {
      if (node.type.name === "image") images.push(node);
    });
  });
  return images;
}

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
  // Written as `\[\[x]]` until the wikilink became a node of its own (daily-driver spec §4): no link at all after a save.
  "a wikilink": "see [[Other Page]] here\n",
  "a wikilink with a heading and an alias": "see [[Other Page#Setup|the setup]] here\n",
};
const rewritten: Record<string, [input: string, output: string]> = {
  "star list becomes dash": ["* one\n* two\n", "- one\n- two\n"],
  "table separator is shortened": ["| a | b |\n|---|---|\n| 1 | 2 |\n", "| a | b |\n| - | - |\n| 1 | 2 |\n"],
  "two trailing spaces become a backslash break": ["line one  \nline two\n", "line one\\\nline two\n"],
  "setext heading becomes ATX": ["Title\n=====\n\ntext\n", "# Title\n\ntext\n"],
  "a redundant escape is dropped": ["a and 1\\. not a list\n", "a and 1. not a list\n"],
  "a star rule becomes dashes": ["a\n\n***\n\nb\n", "a\n\n---\n\nb\n"],
  // mdast-util-to-markdown 2.1.2 (the locked version) escapes every underscore in text; 2.1.3 keeps one between two letters (與_斜體\_，).
  "underscores in text are escaped, including one between CJK letters": ["與_斜體_，\n", "與\\_斜體\\_，\n"],
  // The six writings the 2026-09-29 verification record left unpinned (issue #77):
  // an aligned table has its cells padded (alignment survives); an indented code
  // block becomes fenced; a tilde fence becomes backticks; an ATX closing
  // sequence is dropped; reference links and images are inlined and their
  // definitions removed — the same inlining reference links already had.
  "an aligned table has its cells padded": ["| a   | b |\n|:----|----:|\n| 1   | 2 |\n", "| a  |  b |\n| :- | -: |\n| 1  |  2 |\n"],
  // Syntax of other tools that is text here, and so has its `[` escaped. It reads the same in the Hub — the
  // escape is not part of the text — but an exported file no longer means a callout or an embed to them.
  "a callout marker has its bracket escaped": ["> [!NOTE]\n> hi\n", "> \\[!NOTE]\n> hi\n"],
  "an embed has its brackets escaped": ["![[img.png]]\n", "!\\[\\[img.png]]\n"],
  "a [TOC] marker has its bracket escaped": ["[TOC]\n", "\\[TOC]\n"],
  // Held as a line break, which a table cell can only write as the tag (`table-cell-breaks.ts`).
  "a <br> between text in a table cell becomes <br />": ["| a |\n| - |\n| one<br>two |\n", "| a            |\n| ------------ |\n| one<br />two |\n"],
  "an indented code block becomes fenced": ["    const a = 1;\n", "```\nconst a = 1;\n```\n"],
  "a tilde fence becomes backticks": ["~~~ts\nconst a = 1;\n~~~\n", "```ts\nconst a = 1;\n```\n"],
  "an ATX closing sequence is dropped": ["## Title ##\n", "## Title\n"],
  "reference links are inlined and their definitions removed": [
    "see [site][ref] here\n\n[ref]: https://example.com\n",
    "see [site](https://example.com) here\n",
  ],
  // Reference images used to fail the open with EditorParseError (a lone one) or,
  // worse, vanish silently inside a paragraph. They now resolve like links.
  "reference images are inlined and their definitions removed": ["![alt][ref]\n\n[ref]: /a.png\n", "![alt](/a.png)\n"],
  "a reference image inside a paragraph is kept": ["text ![alt][ref] more\n\n[ref]: /a.png\n", "text ![alt](/a.png) more\n"],
  "duplicate image definitions keep the first destination": [
    "![alt][ref]\n\n[ref]: /first.png\n[ref]: /second.png\n",
    "![alt](/first.png)\n",
  ],
  "duplicate image definitions ignore identifier casing": [
    '![alt][REF]\n\n[ref]: /first.png "first"\n[REF]: /second.png "second"\n',
    '![alt](/first.png "first")\n',
  ],
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

  it("keeps a refused source through copy and paste inside the editor", async () => {
    const { editor } = await open("![x](https://evil.example/a.png)\n");
    const images = pastedImages(editor, copy(editor));
    expect(images.map((image) => image.attrs.src)).toEqual(["https://evil.example/a.png"]);
  });

  it("still gives the copied element an empty src, and carries the real source only in data-kh-src", async () => {
    const { root, editor } = await open("![x](https://evil.example/a.png) ![y](/ok.png)\n");
    const copied = [...copy(editor).querySelectorAll("img")];
    expect(copied.map((image) => image.getAttribute("src"))).toEqual(["", "/ok.png"]);
    expect(copied.map((image) => image.getAttribute("data-kh-src"))).toEqual(["https://evil.example/a.png", "/ok.png"]);
    const live = [...root.querySelectorAll("img")].map((image) => image.getAttribute("src")).filter((src) => src !== null);
    expect(live).toEqual(["", "/ok.png"]);
  });

  it("reads an image pasted from elsewhere from its src, as before", async () => {
    const { editor } = await open("text\n");
    const holder = document.createElement("div");
    holder.innerHTML = '<p><img src="/plain.png" alt="a"></p>';
    const [image] = pastedImages(editor, holder);
    expect(image.attrs).toEqual({ src: "/plain.png", alt: "a", title: "a" });
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

  it("is not opening and focusing any document of the corpus", async () => {
    const corpus: [name: string, markdown: string][] = [
      ...Object.entries(unchanged),
      ...Object.entries(rewritten).map(([name, [input]]): [string, string] => [name, input]),
    ];
    const sessions: { name: string; calls: { edits: number; markdown: string[] } }[] = [];
    for (const [name, markdown] of corpus) {
      const { editor, calls } = await open(markdown);
      editor.focusStart();
      sessions.push({ name, calls });
    }
    await settle();
    expect(sessions.filter(({ calls }) => calls.edits > 0).map(({ name }) => name)).toEqual([]);
    expect(sessions.filter(({ calls }) => calls.markdown.length > 0).map(({ name }) => name)).toEqual([]);
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

  it("emits nothing when typing is reverted inside the debounce (issue #65)", async () => {
    const initial = "# T\n";
    const { editor, calls } = await open(initial);
    type(editor, "Z");
    backspace(editor);
    await settle();
    expect(calls.edits).toBe(2);
    expect(calls.markdown).toEqual([]);
    // Nothing will release `touched` on the composer's behalf: the flush and
    // the source path must compare the flushed content with the initial one.
    expect(editor.getMarkdown()).toBe(initial);
    expect(matchesInitial({ markdown: editor.getMarkdown(), title: "T" }, { markdown: initial, title: "T" })).toBe(true);
  });

  it("delivers the settled value once after a forced read, equal to what the read returned", async () => {
    const { editor, calls } = await open("# T\n");
    type(editor, "Z");
    const flushed = editor.getMarkdown();
    await settle();
    expect(flushed).toBe("# ZT\n");
    expect(calls.markdown).toEqual([flushed]);
  });

  it("leaves no emission behind when the document is replaced while an edit is pending", async () => {
    const { editor, calls } = await open("# T\n");
    type(editor, "Z");
    editor.replaceMarkdown("# Other\n");
    await settle();
    expect(calls.markdown).toEqual([]);
    expect(editor.getMarkdown()).toBe("# Other\n");
  });

  it("drops a pending emission that a change the listener does not see has made stale", async () => {
    const { editor, calls } = await open("# T\n");
    type(editor, "Z");
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.insertText("Q", 1).setMeta("addToHistory", false));
    });
    await settle();
    expect(editor.getMarkdown()).toBe("# QZT\n");
    expect(calls.markdown).toEqual([]);
  });

  it("delivers an edit made after a replacement as usual", async () => {
    const { editor, calls } = await open("# T\n");
    type(editor, "Z");
    editor.replaceMarkdown("# Other\n");
    type(editor, "Y");
    await settle();
    expect(calls.markdown).toEqual(["# YOther\n"]);
  });
});

describe("a failed open", () => {
  function attach() {
    const root = document.createElement("div");
    document.body.appendChild(root);
    return root;
  }
  const create = (root: HTMLElement, overrides: Partial<EditorOptions> = {}) =>
    createMarkdownEditor({
      root,
      markdown: "text\n",
      className: "kh-editor",
      ariaLabel: "Content",
      editable: true,
      onUserEdit: () => {},
      onMarkdown: () => {},
      allowImage: () => true,
      ...overrides,
    });

  it("throws EditorParseError and leaves nothing mounted when a non-empty document parses to nothing", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const root = attach();
    // Without the title fix a title-less image makes Milkdown's parse throw, which it logs and turns into an empty document.
    const failure = create(root, { markdown: "![no title](/a.png)\n", configure: (ctx) => ctx.update(remarkPluginsCtx, () => []) });
    await expect(failure).rejects.toBeInstanceOf(EditorParseError);
    expect(root.querySelector(".ProseMirror")).toBeNull();
    errors.mockRestore();
  });

  it("destroys the half-built editor when the first read throws, and rethrows that error", async () => {
    const root = attach();
    const failure = create(root, {
      configure: (ctx) =>
        ctx.get(listenerCtx).mounted((mounted) =>
          mounted.set(serializerCtx, () => {
            throw new Error("serialiser failed");
          }),
        ),
    });
    await expect(failure).rejects.toThrow("serialiser failed");
    expect(root.querySelector(".ProseMirror")).toBeNull();
  });

  it("does not swallow a failure of create()", async () => {
    const failure = create(attach(), {
      configure: () => {
        throw new Error("configure failed");
      },
    });
    await expect(failure).rejects.toThrow("configure failed");
  });
});

describe("a failed replacement", () => {
  // A lone link reference definition is Markdown the editor makes nothing of: remark reads a
  // `definition` node, and Milkdown has no node for it, so the document comes out empty.
  it("throws EditorParseError when non-empty Markdown replaces to nothing", async () => {
    const { editor } = await open("start\n");
    expect(() => editor.replaceMarkdown("[a]: https://example.com\n")).toThrow(EditorParseError);
  });

  it("accepts an empty document, which is not a failure", async () => {
    const { editor } = await open("start\n");
    editor.replaceMarkdown("");
    expect(editor.getMarkdown().trim()).toBe("");
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

describe("⌘/Ctrl Enter belongs to the form", () => {
  // ProseMirror binds Mod-Enter to "exit the code block / table", which inserts an empty
  // paragraph (written out as `<br />`) before the form's save could read the document.
  it.each([
    ["a code block", "```js\nconst a = 1;\n```\n\nafter\n", "const"],
    ["a table cell", "| a | b |\n| - | - |\n| 1 | 2 |\n\nafter\n", "1"],
  ])("changes nothing in %s, and still lets the key reach the form", async (_where, markdown, inside) => {
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
      const { editor, calls } = await open(markdown);
      const reachedForm = vi.fn();
      document.addEventListener("keydown", reachedForm);
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...modifier });
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        let caret = 0;
        view.state.doc.descendants((node, pos) => {
          if (!caret && node.isText && node.text?.includes(inside)) caret = pos + 1;
        });
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, caret)));
        view.dom.focus();
        view.dom.dispatchEvent(event);
      });
      document.removeEventListener("keydown", reachedForm);
      expect(editor.getMarkdown()).toBe(markdown);
      expect(calls.edits).toBe(0);
      expect(reachedForm).toHaveBeenCalledOnce();
    }
  });
});

describe("a line break inside a table cell", () => {
  // Markdown cannot hold a line ending inside a table row, so the serialiser wrote a break there
  // as a space: the line a person broke with Shift+Enter came back joined. `<br />` is how a cell
  // holds one, and what the reader shows as a break.
  const table = (cell: string) => `| a |\n| - |\n| ${cell} |\n`;
  const cellOf = (markdown: string) => markdown.trimEnd().split("\n").at(-1)!.replace(/^\|\s*|\s*\|$/g, "");
  const nodesIn = (editor: MarkdownEditor) =>
    editor.action((ctx) => {
      const names: string[] = [];
      ctx.get(editorViewCtx).state.doc.descendants((node) => { names.push(node.type.name); });
      return names;
    });

  it("keeps the break a pasted table brings", async () => {
    const { editor } = await open("x\n");
    // What paste makes of clipboard HTML: the schema's parser.
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const holder = document.createElement("div");
      holder.innerHTML = "<table><tr><th>a</th></tr><tr><td>one<br>two</td></tr></table>";
      const pasted = ProseDOMParser.fromSchema(view.state.schema).parse(holder);
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, pasted.content));
    });
    expect(nodesIn(editor)).toContain("hardbreak");
    expect(cellOf(editor.getMarkdown())).toBe("one<br />two");
  });

  /** Shift+Enter at the end of the text `after`, as the keyboard sends it. */
  function shiftEnter(editor: MarkdownEditor, after: string) {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      let caret = 0;
      view.state.doc.descendants((node, pos) => {
        const at = node.isText ? (node.text ?? "").indexOf(after) : -1;
        if (!caret && at >= 0) caret = pos + at + after.length;
      });
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, caret)));
      view.dom.focus();
      view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
    });
  }
  /** The command scrolls the caret into view, which asks for a layout jsdom does not have. */
  function withLayout() {
    const undo = [Range.prototype, Element.prototype].flatMap((proto) =>
      (["getClientRects", "getBoundingClientRect"] as const).map((name) => {
        const had = Object.getOwnPropertyDescriptor(proto, name);
        Object.defineProperty(proto, name, { configurable: true, value: () => (name === "getClientRects" ? [new DOMRect()] : new DOMRect()) });
        return () => (had ? Object.defineProperty(proto, name, had) : Reflect.deleteProperty(proto, name));
      }),
    );
    onTestFinished(() => undo.forEach((restore) => restore()));
  }

  it("breaks the line on Shift+Enter", async () => {
    withLayout();
    const { editor } = await open(table("onetwo"));
    shiftEnter(editor, "one");
    expect(cellOf(editor.getMarkdown())).toBe("one<br />two");
  });

  it("keeps the table a table when Shift+Enter is pressed twice at the end of a cell", async () => {
    withLayout();
    const { editor } = await open(`| a | b |\n| - | - |\n| one | two |\n\nafter\n`);
    shiftEnter(editor, "one");
    shiftEnter(editor, "one");
    const names = nodesIn(editor);
    expect(names.filter((name) => name === "table")).toHaveLength(1);
    expect(names.filter((name) => name === "table_cell")).toHaveLength(2);
    expect(editor.getMarkdown()).toBe("| a   | b   |\n| --- | --- |\n| one | two |\n\nafter\n");
  });

  it("does not keep breaks typed at the end of a cell", async () => {
    withLayout();
    const { editor } = await open(table("one"));
    shiftEnter(editor, "one");
    shiftEnter(editor, "one");
    shiftEnter(editor, "one");
    expect(nodesIn(editor).filter((name) => name === "hardbreak")).toHaveLength(3);
    expect(cellOf(editor.getMarkdown())).toBe("one");
  });

  it("keeps an empty line between two lines of a cell", async () => {
    withLayout();
    const { editor } = await open(table("onetwo"));
    shiftEnter(editor, "one");
    shiftEnter(editor, "one");
    expect(cellOf(editor.getMarkdown())).toBe("one<br /><br />two");
  });

  it("still makes no break in a code block", async () => {
    withLayout();
    const { editor } = await open("```\nonetwo\n```\n");
    shiftEnter(editor, "one");
    expect(nodesIn(editor)).not.toContain("hardbreak");
  });

  it.each([["<br>"], ["<br/>"], ["<br />"], ["<BR>"]])("holds a %s written in a cell as a break, not as text", async (tag) => {
    const { editor } = await open(table(`one${tag}two`));
    const names = nodesIn(editor);
    expect(names).toContain("hardbreak");
    expect(names).not.toContain("html");
    expect(cellOf(editor.getMarkdown())).toBe("one<br />two");
  });

  it("writes a document it saved back unchanged", async () => {
    const saved = table("one<br />two<br />three");
    const { editor } = await open(saved);
    expect(editor.getMarkdown()).toBe(saved.replace("| a |\n| - |", "| a                       |\n| ----------------------- |"));
  });

  it("keeps a <br> that ends a cell: as a break it would be dropped on the way out", async () => {
    const { editor } = await open(table("one<br>"));
    expect(cellOf(editor.getMarkdown())).toBe("one<br>");
  });

  it("still holds a cell that is only a <br> as an empty cell", async () => {
    const { editor } = await open(table("<br />"));
    expect(nodesIn(editor)).not.toContain("hardbreak");
    expect(cellOf(editor.getMarkdown())).toBe("");
  });

  it.each([
    ["a break in a paragraph", "one\\\ntwo\n"],
    ["a <br> in a paragraph", "one<br>two\n"],
  ])("leaves %s as it was written", async (_name, markdown) => {
    const { editor } = await open(markdown);
    expect(editor.getMarkdown()).toBe(markdown);
  });

  it("leaves other HTML in a cell as it was written", async () => {
    const { editor } = await open(table("one<u>two</u>"));
    expect(cellOf(editor.getMarkdown())).toBe("one<u>two</u>");
  });
});
