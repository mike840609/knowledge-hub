// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { extractDocumentLinks } from "@/modules/knowledge/domain/document-links";

// Decision 21 of the Notion-parity spec: clipboard HTML from other apps.
const rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => rect;
const opened: MarkdownEditor[] = [];
afterEach(async () => { for (const editor of opened.splice(0)) await editor.destroy(); document.body.innerHTML = ""; });

async function open(markdown: string) {
  const root = document.body.appendChild(document.createElement("div"));
  const editor = await createMarkdownEditor({
    root, markdown, className: "kh-editor", ariaLabel: "Content", editable: true, onUserEdit: () => {}, onMarkdown: () => {}, allowImage: () => false,
  });
  opened.push(editor);
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  view.dom.focus();
  return { editor, view };
}
function pasteHtml(view: EditorView, html: string, text = "") {
  const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", { value: { getData: (type: string) => (type === "text/html" ? html : type === "text/plain" ? text : ""), files: [], types: ["text/html"] } });
  view.dom.dispatchEvent(event);
}
async function pasted(html: string) {
  const { editor, view } = await open("\n");
  pasteHtml(view, html);
  const markdown = editor.getMarkdown();
  const again = await open(markdown);
  expect(again.editor.getMarkdown()).toBe(markdown);
  return markdown;
}

describe("clipboard HTML (21)", () => {
  it.each(["s", "strike", "del"])("pastes <%s> as strikethrough", async (tag) => {
    expect(await pasted(`<p>a <${tag}>gone</${tag}> b</p>`)).toBe("a ~~gone~~ b\n");
  });

  it("pastes checkbox items as to-dos with their state", async () => {
    const md = await pasted('<ul><li><input type="checkbox" checked> done</li><li><p><input type="checkbox"> open</p></li><li><label><input type="checkbox" checked>both</label></li><li>plain</li></ul>');
    expect(md).toContain("- [x] done");
    expect(md).toContain("- [ ] open");
    expect(md).toContain("- [x] both");
    expect(md).toMatch(/- plain/);
    expect(md).not.toContain("input");
  });

  it("uses the first row of a header-less table as the header", async () => {
    const md = await pasted("<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></tbody></table>");
    expect(md).toBe("| A  | B  |\n| :- | :- |\n| 1  | 2  |\n");
  });

  it("leaves a table that has a header alone", async () => {
    const md = await pasted("<table><thead><tr><th>H1</th><th>H2</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>");
    expect(md).toBe("| H1 | H2 |\n| :- | :- |\n| 1  | 2  |\n| 3  | 4  |\n");
  });

  it("keeps wikilinks in pasted text readable by the extractor", async () => {
    const md = await pasted("<p><s>old</s> see [[Some Page]] and [[Other|shown]]</p>");
    expect(md).toContain("~~old~~");
    expect(extractDocumentLinks(md).map(l => l.target)).toEqual(["Some Page", "Other"]);
  });
});
