import { Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, remarkPluginsCtx, remarkStringifyOptionsCtx, rootCtx } from "@milkdown/kit/core";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { commonmark, imageSchema } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { Plugin, Selection } from "@milkdown/kit/prose/state";
import { $ctx, $prose, getMarkdown, replaceAll } from "@milkdown/kit/utils";

/** The editor could not make a document of this Markdown; the caller should fall back to the source. */
export class EditorParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditorParseError";
  }
}

/**
 * A parse that turned a non-empty document into nothing is a failed parse, not
 * an empty document: Milkdown logs the error and carries on with an empty one.
 */
export function parsedIntact(markdown: string, output: string): boolean {
  return markdown.trim() === "" || output.trim() !== "";
}

// Per editor, through the context, because the plugin list below is shared.
const imagePolicyCtx = $ctx<(src: string) => boolean, "khImagePolicy">(() => false, "khImagePolicy");

/**
 * The reader never lets `<img>` fetch a source its policy refuses; neither may
 * the editor. The document keeps the URL — only the element loses its `src`.
 *
 * ProseMirror's clipboard goes through the same `toDOM`/`parseDOM`, so the real
 * source also travels in `data-kh-src`, which no browser loads, and the parser
 * prefers it: copy and paste inside the editor must not blank the URL.
 */
const safeImageSchema = imageSchema.extendSchema((previous) => (ctx) => {
  const spec = previous(ctx);
  const allow = ctx.get(imagePolicyCtx.key);
  const toDOM = spec.toDOM;
  if (!toDOM) return spec;
  return {
    ...spec,
    // Milkdown's own rule, except that `src` reads `data-kh-src` first.
    parseDOM: [
      {
        tag: "img[src]",
        getAttrs: (dom) => ({
          src: dom.getAttribute("data-kh-src") ?? dom.getAttribute("src") ?? "",
          alt: dom.getAttribute("alt") || "",
          title: dom.getAttribute("title") || dom.getAttribute("alt") || "",
        }),
      },
    ],
    toDOM: (node) => {
      const [tag, attrs] = toDOM(node) as [string, Record<string, unknown>];
      const source = String(node.attrs.src ?? "");
      return [tag, { ...attrs, src: allow(source) ? attrs.src : "", ...(source ? { "data-kh-src": source } : {}) }];
    },
  };
});
const commonmarkWithSafeImages = commonmark.filter((plugin) => plugin !== imageSchema[0] && plugin !== imageSchema[1]);

type MarkdownNode = { type: string; title?: string | null; children?: MarkdownNode[] };

/** Milkdown 7.22 hands a title-less image's `null` title to a ProseMirror attribute that must be a string, and the parse throws. */
const fillNullImageTitles = () => (tree: MarkdownNode) => {
  const walk = (node: MarkdownNode) => {
    if (node.type === "image" && node.title == null) node.title = "";
    node.children?.forEach(walk);
  };
  walk(tree);
};

export type EditorOptions = {
  root: HTMLElement;
  markdown: string;
  /** Classes for the editable element (the reader's prose classes). */
  className: string;
  ariaLabel: string;
  editable: boolean;
  /**
   * A change made by the person typing — not the initial parse, not `replaceMarkdown`. Synchronous.
   * It can fire more than once for one keystroke (transactions appended to it pass through as well),
   * and it runs inside ProseMirror's state update: do not call back into the editor from it —
   * `getMarkdown()` there would read the document from before the edit.
   */
  onUserEdit: () => void;
  /**
   * The document as Markdown, after a change has settled (Milkdown debounces this by ~200 ms).
   * It always describes the document as it is when delivered: an emission that the document has
   * moved past is dropped, so a change made by a route the listener does not see (`replaceMarkdown`,
   * a transaction marked `addToHistory: false`) leaves no stale value behind. A `getMarkdown()` call
   * does not cancel a pending emission; the settled value still arrives once, equal to what it returned.
   */
  onMarkdown: (markdown: string) => void;
  allowImage: (src: string) => boolean;
  extraPlugins?: MilkdownPlugin[];
  /** Runs with the editor context while it is being configured — for the extra plugins' settings. */
  configure?: (ctx: Ctx) => void;
};

export type MarkdownEditor = {
  /** The document as Markdown right now, without waiting for the debounce (a pending `onMarkdown` still arrives once, with the same value). */
  getMarkdown: () => string;
  /** Replaces the whole document. Emits no `onUserEdit` and no `onMarkdown` — not even for an edit still waiting out its debounce — and clears the undo history. */
  replaceMarkdown: (markdown: string) => void;
  setEditable: (editable: boolean) => void;
  /** Focus with the selection where it is. */
  focus: () => void;
  /** Focus with the caret at the very start of the document. */
  focusStart: () => void;
  action: <T>(fn: (ctx: Ctx) => T) => T;
  destroy: () => Promise<void>;
};

/** Tears down a half-built editor without letting a failure of the teardown hide the error that caused it. */
async function destroyAfterFailure(editor: Editor): Promise<void> {
  try {
    await editor.destroy();
  } catch {
    // The original failure is the one the caller needs to see.
  }
}

export async function createMarkdownEditor(options: EditorOptions): Promise<MarkdownEditor> {
  let editable = options.editable;
  const editWatcher = $prose(
    () =>
      new Plugin({
        state: {
          init: () => null,
          apply: (transaction) => {
            if (transaction.docChanged && transaction.getMeta("addToHistory") !== false) options.onUserEdit();
            return null;
          },
        },
      }),
  );

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, options.root);
      ctx.set(defaultValueCtx, options.markdown);
      ctx.set(imagePolicyCtx.key, options.allowImage);
      // Milkdown's defaults are `*` and `***`; most documents here use `-` and `---`.
      ctx.update(remarkStringifyOptionsCtx, (previous) => ({ ...previous, bullet: "-" as const, rule: "-" as const }));
      ctx.update(remarkPluginsCtx, (previous) => [...previous, { plugin: fillNullImageTitles, options: {} }] as typeof previous);
      ctx.update(editorViewOptionsCtx, (previous) => ({
        ...previous,
        editable: () => editable,
        attributes: {
          ...(typeof previous.attributes === "object" ? previous.attributes : {}),
          class: `editor ${options.className}`,
          "aria-label": options.ariaLabel,
        },
      }));
      options.configure?.(ctx);
      ctx.get(listenerCtx).markdownUpdated((current, markdown, previous) => {
        if (markdown === previous) return;
        // The debounced emission serialises the last change the listener saw. If the
        // document has moved on by a route it does not see, that value is stale.
        if (markdown !== getMarkdown()(current)) return;
        options.onMarkdown(markdown);
      });
    })
    .use(commonmarkWithSafeImages)
    .use(safeImageSchema)
    .use(imagePolicyCtx)
    .use(gfm)
    .use(history)
    .use(listener)
    .use(editWatcher)
    .use(options.extraPlugins ?? [])
    .create();

  // A rejected `create()` propagates untouched and is not followed by `destroy()`: Milkdown then
  // stays in its "OnCreate" status and `destroy()` would wait for it forever. The caller owns
  // `root` and discards it on that path. Once created, every way out but success destroys the editor.
  let initial: string;
  try {
    initial = editor.action(getMarkdown());
  } catch (error) {
    await destroyAfterFailure(editor);
    throw error;
  }
  if (!parsedIntact(options.markdown, initial)) {
    await destroyAfterFailure(editor);
    throw new EditorParseError("The editor produced an empty document from non-empty Markdown.");
  }

  return {
    getMarkdown: () => editor.action(getMarkdown()),
    replaceMarkdown: (markdown) => editor.action(replaceAll(markdown, true)),
    setEditable: (next) => {
      editable = next;
      editor.action((ctx) => ctx.get(editorViewCtx).setProps({ editable: () => editable }));
    },
    focus: () => editor.action((ctx) => ctx.get(editorViewCtx).focus()),
    focusStart: () =>
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(view.state.tr.setSelection(Selection.atStart(view.state.doc)));
        view.focus();
      }),
    action: (fn) => editor.action(fn),
    destroy: async () => {
      await editor.destroy();
    },
  };
}
