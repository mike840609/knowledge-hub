// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { DOMParser as ProseDOMParser, DOMSerializer, Slice } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMarkdownEditor, type EditorOptions, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";

// Hub image upload spec §6: the editor shows a page's image through a route, and takes pasted and
// dropped image files. Both run the *rendered* editor: what it shows must never reach the Markdown.
const opened: MarkdownEditor[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.destroy();
  document.body.innerHTML = "";
});

const served = (src: string) => `/api/sources/s1/asset?src=${encodeURIComponent(src)}`;
async function open(markdown: string, overrides: Partial<EditorOptions> = {}) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const calls = { edits: 0 };
  const editor = await createMarkdownEditor({
    root, markdown, className: "kh-editor", ariaLabel: "Content", editable: true,
    onUserEdit: () => { calls.edits += 1; }, onMarkdown: () => {},
    allowImage: (src) => src.startsWith("/"),
    imageUrl: served,
    ...overrides,
  });
  opened.push(editor);
  return { root, editor, calls, view: editor.action((ctx) => ctx.get(editorViewCtx)) };
}
/** The document's image. ProseMirror also draws `img.ProseMirror-separator` elements of its own. */
const picture = (root: Element) => root.querySelector("img[data-kh-src]")!;
const png = (name = "shot.png") => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: "image/png" });
const transfer = (...files: File[]) => ({ files, getData: () => "", types: files.length ? ["Files"] : [] }) as unknown as DataTransfer;

describe("an image a Hub page refers to", () => {
  const cases = [
    "![diagram](/images/aa.png)",
    "![with a title](/images/aa.png \"Title\")",
    "Before ![inline](/images/aa.png) after.",
    "![](/images/aa.png)",
    "![relative](images/aa.png)",
  ];
  it("is shown through the route, and written back exactly as it was read", async () => {
    for (const markdown of cases) {
      const { root, editor } = await open(`${markdown}\n`);
      const image = picture(root);
      const source = /\(([^ )]+)/.exec(markdown)![1];
      if (source.startsWith("/")) expect(image.getAttribute("src"), markdown).toBe(served(source));
      expect(image.getAttribute("data-kh-src"), markdown).toBe(source);
      expect(editor.getMarkdown(), markdown).toBe(`${markdown}\n`);
    }
  });
  it("still writes the source as written after an edit elsewhere in the document", async () => {
    const { editor, view } = await open("![diagram](/images/aa.png)\n\nText\n");
    view.dispatch(view.state.tr.insertText(" more", view.state.doc.content.size - 1));
    expect(editor.getMarkdown()).toBe("![diagram](/images/aa.png)\n\nText more\n");
  });
  it("a refused source is not sent to the route either: the element stays empty", async () => {
    const { root, editor } = await open("![remote](https://evil.example/a.png)\n");
    expect(picture(root).getAttribute("src")).toBe("");
    expect(editor.getMarkdown()).toBe("![remote](https://evil.example/a.png)\n");
  });
  it("copied out and pasted back, it keeps its source, not the route's URL", async () => {
    const { editor, view } = await open("![diagram](/images/aa.png)\n");
    const dom = DOMSerializer.fromSchema(view.state.schema).serializeFragment(view.state.doc.content);
    const holder = document.createElement("div");
    holder.appendChild(dom);
    expect(picture(holder).getAttribute("src")).toBe(served("/images/aa.png"));
    const parsed = ProseDOMParser.fromSchema(view.state.schema).parse(holder);
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, parsed.content));
    // Reading an element back gives the image its alt as a title (the editor's existing rule); the source is what matters here.
    expect(editor.getMarkdown()).toContain("](/images/aa.png");
    expect(editor.getMarkdown()).not.toContain("/api/sources/");
  });
  it("without a mapping, the element's src is the source, as before", async () => {
    const { root } = await open("![diagram](/images/aa.png)\n", { imageUrl: undefined });
    expect(picture(root).getAttribute("src")).toBe("/images/aa.png");
  });
});

describe("adding an image", () => {
  it("insertImage writes exactly ![alt](src) at the caret, as the user's edit", async () => {
    const { editor, view, calls } = await open("One\n\nTwo\n");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));
    const before = calls.edits;
    editor.insertImage("/images/bb.png", "Pasted image");
    expect(editor.getMarkdown()).toBe("One![Pasted image](/images/bb.png)\n\nTwo\n");
    expect(calls.edits).toBe(before + 1);
  });
  it("insertImage into an empty document makes a paragraph that holds it", async () => {
    const { editor } = await open("");
    editor.insertImage("/images/bb.png", "shot");
    expect(editor.getMarkdown().trim()).toBe("![shot](/images/bb.png)");
  });
  it("an alt with brackets is escaped by the writer, and read back the same", async () => {
    const { editor } = await open("");
    editor.insertImage("/images/bb.png", "a [b] c");
    const written = editor.getMarkdown();
    const again = await open(written);
    expect(picture(again.root).getAttribute("alt")).toBe("a [b] c");
    expect(again.editor.getMarkdown()).toBe(written);
  });
  it("a paste carrying image files goes to the host and is not pasted", async () => {
    const onImageFiles = vi.fn();
    const { editor, view } = await open("Text\n", { onImageFiles });
    const event = { clipboardData: transfer(png(), new File(["x"], "notes.txt", { type: "text/plain" })), preventDefault: vi.fn() } as unknown as ClipboardEvent;
    const handled = view.someProp("handlePaste", (handle) => handle(view, event, Slice.empty));
    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onImageFiles).toHaveBeenCalledOnce();
    expect(onImageFiles.mock.calls[0][0].map((file: File) => file.name)).toEqual(["shot.png"]);
    expect(editor.getMarkdown()).toBe("Text\n");
  });
  it("a paste with no image files is left to the editor", async () => {
    const onImageFiles = vi.fn();
    const { view } = await open("Text\n", { onImageFiles });
    for (const clipboardData of [transfer(), transfer(new File(["x"], "notes.txt", { type: "text/plain" })), null]) {
      const event = { clipboardData, preventDefault: vi.fn() } as unknown as ClipboardEvent;
      expect(Boolean(view.someProp("handlePaste", (handle) => handle(view, event, Slice.empty)))).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(onImageFiles).not.toHaveBeenCalled();
  });
  it("a drop carrying image files goes to the host; a move inside the editor does not", async () => {
    const onImageFiles = vi.fn();
    const { view } = await open("Text\n", { onImageFiles });
    // jsdom has no layout: posAtCoords finds nothing and the caret stays where it was.
    view.posAtCoords = () => null;
    const drop = () => ({ dataTransfer: transfer(png("drop.png")), clientX: 1, clientY: 1, preventDefault: vi.fn() }) as unknown as DragEvent;
    expect(view.someProp("handleDrop", (handle) => handle(view, drop(), Slice.empty, false))).toBe(true);
    expect(onImageFiles).toHaveBeenCalledOnce();
    expect(Boolean(view.someProp("handleDrop", (handle) => handle(view, drop(), Slice.empty, true)))).toBe(false);
    expect(onImageFiles).toHaveBeenCalledOnce();
  });
  it("takes nothing when it is not editable, or when the host does not handle images", async () => {
    const onImageFiles = vi.fn();
    const readOnly = await open("Text\n", { onImageFiles, editable: false });
    const paste = () => ({ clipboardData: transfer(png()), preventDefault: vi.fn() }) as unknown as ClipboardEvent;
    expect(Boolean(readOnly.view.someProp("handlePaste", (handle) => handle(readOnly.view, paste(), Slice.empty)))).toBe(false);
    const plain = await open("Text\n");
    expect(Boolean(plain.view.someProp("handlePaste", (handle) => handle(plain.view, paste(), Slice.empty)))).toBe(false);
    expect(onImageFiles).not.toHaveBeenCalled();
  });
});
