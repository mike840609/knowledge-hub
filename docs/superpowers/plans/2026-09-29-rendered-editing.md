# Rendered Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The document composer edits the rendered document by default and can switch to the Markdown source (today's textarea), so writing feels like Linear's editor.

**Architecture:** `markdown` stays the composer's only state, so the title rules, drafts, 409 handling and save need no change. A Milkdown editor is a second view of that string: it is parsed from it, and turns back into it after a change settles (Milkdown debounces ~200 ms) or on demand (save, mode switch, leaving). Opening never writes back. The editor is loaded on demand with `ssr: false`; until it is ready the reader's own rendering stands in for it.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind (replaced scales), `@milkdown/kit` 7.22.2 (ProseMirror + remark), Vitest with `jsdom` for the editor's unit tests, Playwright (Chromium).

**Spec:** `docs/superpowers/specs/2026-09-28-document-composer-design.md` §11 (§1–10 are already implemented on this branch, `feat/document-composer`).

## Global Constraints

- **New packages, exactly these:** `@milkdown/kit@7.22.2` in `dependencies` (pinned with `--save-exact`), `jsdom` in `devDependencies`. Nothing else: not `@milkdown/react`, not `@milkdown/crepe`, not a Milkdown theme (they bring CSS with colours outside the `kh-*` tokens).
- Tailwind `fontSize`, `borderRadius`, `boxShadow`, `transitionDuration`, `transitionTimingFunction`, `maxWidth`, `padding`, `margin`, `gap`, `space` scales are **replaced**: only contract token names compile (`text-body`, `text-reading`, `rounded-md`, `rounded-lg`, `shadow-popover`, `px-3`, `gap-2`, `py-6`, …). `text-sm`, `rounded`, `px-7` produce no CSS.
- No colour outside `kh-*` tokens. Controls keep `kh-focus-ring`; the rendered editor, the Markdown textarea and the title field are the documented exception and carry none.
- Visibility is toggled with the `hidden` attribute **or** a swapped class list, never with a `display` utility (`flex`, `block`, …) left on the same element: it would override `[hidden]`.
- **Every button built inside the editor is `type="button"`.** The editor sits in the composer's `<form>`, where the default type submits — that is, saves.
- `⌘/Ctrl K` is the global search; nothing in the editor binds it.
- API contract unchanged: `PATCH /api/documents/:id` takes `{ title, markdown, expectedCurrentRevisionId }`. Nothing calls the authoring API except Save/Create and the existing upload. No autosave.
- Opening a document must not write back and must not make it dirty. Only a change made by the person typing does (`onUserEdit`).
- UI copy, verbatim: toggle label `Markdown`, toggle title `Show Markdown source (⌘/)`, editor name `Content`, toolbar name `Formatting`, toolbar buttons `Bold`, `Italic`, `Link`, `Heading 1`, `Heading 2`, `Bulleted list`, `Numbered list`, link box name `Link address`, failure notice `這份文件的排版無法在渲染模式下編輯，已改用 Markdown 模式。`
- **This machine's shell:** bare `npm`, `npx` and `node` are shadowed by an nvm function and fail with `command not found: _nvm_load`; exporting PATH is not enough for `npm`. Use `B=/Users/chuntsai/.nvm/versions/node/v24.6.0/bin; export PATH=$B:$PATH` and call `$B/node $B/npm …` for npm, `node_modules/.bin/<tool>` for everything else, and `make` targets after the PATH export in the same command. Never pipe a test command into `tail`/`head` without printing its exit code: `cmd > log 2>&1; echo "EXIT=$?"`.
- Known intermittent test, present on `main`: `phase5-authoring.spec.ts` › "after a save, the sidebar names the document by its new title" (~7–17 % of runs). If it is the only failure of a full `make test-e2e`, re-run once and report both runs.
- Docker must be running for `make test-e2e` (it provisions its own database, builds, runs Chromium; ~10 minutes: use a 600000 ms timeout or run in the background and read the log).
- Leave the untracked `.codex/`, `.playwright-mcp/`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` alone; `git add` only the files a task names. `.superpowers/` is git-ignored scratch.
- Commit messages end with the line `Claude-Session: https://claude.ai/code/session_0147bSAtofdFgcV3oVdWtipa`.

## Why the code below is trustworthy

Task 1's `editor-core.ts` and its 33 unit tests, Task 2's `selection-toolbar.ts` and `rendered-editor.tsx` were written and run first in a scratch project (`.superpowers/mk-probe/`): the core passes the repo's `tsc` and repo's vitest (v2.1.9, `jsdom` environment); the toolbar and wrapper pass `tsc`. The composer, the CSS and the browser behaviour were **not** run: Task 3 is a gate for exactly that.

## File Structure

```text
Create  src/components/knowledge/editor/editor-core.ts        createMarkdownEditor(), parsedIntact() — Milkdown, no React
Create  src/components/knowledge/editor/selection-toolbar.ts  the toolbar over a text selection — DOM, no React
Create  src/components/knowledge/editor/rendered-editor.tsx   <RenderedEditor>, the React wrapper (loaded with next/dynamic)
Create  src/components/knowledge/markdown-prose.ts            MARKDOWN_PROSE — the reader's prose classes, shared
Create  tests/unit/markdown-editor.test.ts                    round-trip corpus, image policy, what counts as an edit
Create  tests/e2e/composer-helpers.ts                         showMarkdown()
Modify  package.json, package-lock.json
Modify  src/components/knowledge/markdown-renderer.tsx        use MARKDOWN_PROSE
Modify  src/app/globals.css                                    .kh-editor, .kh-selection-toolbar
Modify  src/lib/form-keys.ts, tests/unit/form-keys.test.ts    ⌘/ instead of ⌘⇧P and preview
Modify  src/components/knowledge/use-form-keys.ts
Modify  src/components/knowledge/document-composer.tsx        rendered mode
Modify  tests/e2e/document-composer.spec.ts                   rewritten for rendered editing
Modify  tests/e2e/phase5-authoring.spec.ts, share-link.spec.ts, phase2.5-knowledge-explorer.spec.ts
Modify  docs (Task 5)
```

---

### Task 1: The editor core, with its round-trip tests

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/components/knowledge/editor/editor-core.ts`
- Test: `tests/unit/markdown-editor.test.ts`

**Interfaces:**
- Produces (Tasks 2 and 3 rely on these exact names):
  - `class EditorParseError extends Error`
  - `parsedIntact(markdown: string, output: string): boolean`
  - `type EditorOptions = { root: HTMLElement; markdown: string; className: string; ariaLabel: string; editable: boolean; onUserEdit: () => void; onMarkdown: (markdown: string) => void; allowImage: (src: string) => boolean; extraPlugins?: MilkdownPlugin[]; configure?: (ctx: Ctx) => void }`
  - `type MarkdownEditor = { getMarkdown(): string; replaceMarkdown(markdown: string): void; setEditable(editable: boolean): void; focus(): void; focusStart(): void; action<T>(fn: (ctx: Ctx) => T): T; destroy(): Promise<void> }`
  - `createMarkdownEditor(options: EditorOptions): Promise<MarkdownEditor>` — throws `EditorParseError` when a non-empty document parses to nothing.

- [ ] **Step 1: Install the two packages**

```bash
cd /Users/chuntsai/Projects/HCM-KM
B=/Users/chuntsai/.nvm/versions/node/v24.6.0/bin; export PATH=$B:$PATH
$B/node $B/npm install --save-exact @milkdown/kit@7.22.2 > .superpowers/npm1.log 2>&1; echo "EXIT=$?"
$B/node $B/npm install --save-dev jsdom > .superpowers/npm2.log 2>&1; echo "EXIT=$?"
git diff --stat package.json package-lock.json
git diff package.json
```

Expected: both `EXIT=0`. `package.json` gains `"@milkdown/kit": "7.22.2"` under `dependencies` and `"jsdom"` under `devDependencies`, and nothing else. If `package-lock.json` rewrites unrelated entries, that is npm normalising; accept only if the diff of `package.json` is exactly those two lines.

- [ ] **Step 2: Write the failing test**

`tests/unit/markdown-editor.test.ts`:

```ts
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
  "an underscore that could close emphasis beside CJK text is escaped": ["與_斜體_，\n", "與_斜體\\_，\n"],
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
```

- [ ] **Step 3: Run it to see it fail**

```bash
cd /Users/chuntsai/Projects/HCM-KM
export PATH=/Users/chuntsai/.nvm/versions/node/v24.6.0/bin:$PATH
node_modules/.bin/vitest run --config vitest.config.ts tests/unit/markdown-editor.test.ts > .superpowers/t1.log 2>&1; echo "EXIT=$?"; grep -E "Failed to resolve|Cannot find|FAIL" .superpowers/t1.log | head -3
```

Expected: `EXIT=1`, failing to resolve `@/components/knowledge/editor/editor-core`.

- [ ] **Step 4: Write the core**

`src/components/knowledge/editor/editor-core.ts`:

```ts
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
 */
const safeImageSchema = imageSchema.extendSchema((previous) => (ctx) => {
  const spec = previous(ctx);
  const allow = ctx.get(imagePolicyCtx.key);
  const toDOM = spec.toDOM;
  if (!toDOM) return spec;
  return {
    ...spec,
    toDOM: (node) => {
      const [tag, attrs] = toDOM(node) as [string, Record<string, unknown>];
      return [tag, { ...attrs, src: allow(String(node.attrs.src ?? "")) ? attrs.src : "" }];
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
  /** A change made by the person typing — not the initial parse, not `replaceMarkdown`. Synchronous. */
  onUserEdit: () => void;
  /** The document as Markdown, after a change has settled (Milkdown debounces this by ~200 ms). */
  onMarkdown: (markdown: string) => void;
  allowImage: (src: string) => boolean;
  extraPlugins?: MilkdownPlugin[];
  /** Runs with the editor context while it is being configured — for the extra plugins' settings. */
  configure?: (ctx: Ctx) => void;
};

export type MarkdownEditor = {
  /** The document as Markdown right now, without waiting for the debounce. */
  getMarkdown: () => string;
  /** Replaces the whole document. Emits no `onUserEdit` and no `onMarkdown`, and clears the undo history. */
  replaceMarkdown: (markdown: string) => void;
  setEditable: (editable: boolean) => void;
  /** Focus with the selection where it is. */
  focus: () => void;
  /** Focus with the caret at the very start of the document. */
  focusStart: () => void;
  action: <T>(fn: (ctx: Ctx) => T) => T;
  destroy: () => Promise<void>;
};

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
      ctx.get(listenerCtx).markdownUpdated((_ctx, markdown, previous) => {
        if (markdown !== previous) options.onMarkdown(markdown);
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

  if (!parsedIntact(options.markdown, editor.action(getMarkdown()))) {
    await editor.destroy();
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
```

- [ ] **Step 5: Run the tests to see them pass**

```bash
export PATH=/Users/chuntsai/.nvm/versions/node/v24.6.0/bin:$PATH
node_modules/.bin/vitest run --config vitest.config.ts tests/unit/markdown-editor.test.ts > .superpowers/t1.log 2>&1; echo "EXIT=$?"; grep -E "Tests |Test Files" .superpowers/t1.log
```

Expected: `EXIT=0`, `Tests 33 passed (33)`. If a round-trip case differs, the actual output is the fact: check it against the input, and if the difference is a real change in Milkdown's behaviour update the expectation and say so in the report — do not edit `editor-core.ts` to make an expectation pass.

- [ ] **Step 6: Typecheck and lint**

```bash
node_modules/.bin/tsc --noEmit > .superpowers/t1tsc.log 2>&1; echo "TSC=$?"
node_modules/.bin/eslint src/components/knowledge/editor tests/unit/markdown-editor.test.ts > .superpowers/t1lint.log 2>&1; echo "LINT=$?"; head -20 .superpowers/t1tsc.log .superpowers/t1lint.log
```

Expected: `TSC=0`, `LINT=0`. `tsconfig.json` includes `src/**` and `tests/**`; the `@milkdown/kit` types resolve from `node_modules`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/components/knowledge/editor/editor-core.ts tests/unit/markdown-editor.test.ts
git commit -m "feat(editor): a Milkdown core that opens without writing back, with a round-trip corpus

Claude-Session: https://claude.ai/code/session_0147bSAtofdFgcV3oVdWtipa"
```

---

### Task 2: The selection toolbar, the React wrapper, the shared prose classes and the editor styles

Nothing here is mounted yet; Task 3 mounts it. This task ends with a green typecheck, lint and build.

**Files:**
- Create: `src/components/knowledge/markdown-prose.ts`
- Modify: `src/components/knowledge/markdown-renderer.tsx` (the outer `<div className="…">` only)
- Create: `src/components/knowledge/editor/selection-toolbar.ts`
- Create: `src/components/knowledge/editor/rendered-editor.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: Task 1's `createMarkdownEditor`, `MarkdownEditor`.
- Produces:
  - `MARKDOWN_PROSE: string` from `@/components/knowledge/markdown-prose`
  - `selectionToolbar(): { plugins: MilkdownPlugin[]; configure: (ctx: Ctx) => void }`
  - `type RenderedEditorProps = { markdown: string; editable: boolean; onReady: (editor: MarkdownEditor) => void; onFail: () => void; onUserEdit: () => void; onMarkdown: (markdown: string) => void }` and `RenderedEditor(props)`; it builds the editor **once**.

- [ ] **Step 1: Share the reader's prose classes**

`src/components/knowledge/markdown-prose.ts`:

```ts
/**
 * How rendered Markdown is typeset. The reader (`MarkdownRenderer`) and the
 * composer's rendered editor both put these on the element that holds the
 * content, so they cannot drift apart. Composer spec §11.4.
 */
export const MARKDOWN_PROSE =
  "min-w-0 text-reading text-kh-text [&_h1]:mt-6 [&_h1]:text-display [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mt-6 [&_h2]:text-heading [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mt-5 [&_h3]:text-title [&_h3]:font-semibold [&_h4]:mt-4 [&_h4]:text-body [&_h4]:font-semibold [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_td]:border-t [&_td]:border-kh-border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:bg-kh-bg-subtle [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_tr]:border-kh-border [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_blockquote]:border-l-2 [&_blockquote]:border-kh-border [&_blockquote]:pl-4 [&_blockquote]:text-kh-text-muted [&_code]:rounded-md [&_code]:bg-kh-bg-subtle [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-body-sm [&_hr]:my-6 [&_hr]:border-kh-border";
```

In `src/components/knowledge/markdown-renderer.tsx`, add `import { MARKDOWN_PROSE } from "./markdown-prose";` next to the existing `./markdown-image` import, and replace the whole `className="min-w-0 text-reading … [&_hr]:border-kh-border"` on the outer `<div>` inside `MarkdownRenderer` with `className={MARKDOWN_PROSE}`. Then prove the string is byte-identical:

```bash
git diff -U0 src/components/knowledge/markdown-renderer.tsx | grep '^-.*className=' | sed 's/^-.*className="//; s/">$//' > .superpowers/old-prose.txt
sed -n 's/^  "\(.*\)";$/\1/p' src/components/knowledge/markdown-prose.ts > .superpowers/new-prose.txt
cmp .superpowers/old-prose.txt .superpowers/new-prose.txt && echo IDENTICAL
grep -n "content" tailwind.config.ts | head -3
```

Expected: `IDENTICAL`, and the Tailwind `content` globs include `.ts` files under `src` (if they list only `.tsx`, add `./src/**/*.ts` — the classes live in a `.ts` file now).

- [ ] **Step 2: The editor and toolbar styles**

In `src/app/globals.css`, inside the existing `@layer components { … }`, directly after the `.kh-interactive-row { … }` rule, add:

```css
  /* The rendered editor (composer spec §11). The reader's prose classes are on the
     element itself; these are the parts React gives the reader as components. */
  .kh-editor {
    @apply min-h-[12rem] outline-none;
  }
  .kh-editor > :first-child {
    @apply mt-0;
  }
  .kh-editor li > p {
    @apply my-0;
  }
  .kh-editor a {
    @apply cursor-text font-medium text-kh-link underline decoration-kh-link underline-offset-2;
  }
  .kh-editor img {
    @apply my-4 h-auto max-w-full rounded-md border border-kh-border;
  }
  .kh-editor pre {
    @apply my-4 overflow-x-auto rounded-md border border-kh-border bg-kh-bg-subtle px-4 py-3 font-mono text-body-sm leading-6 text-kh-text;
  }
  .kh-editor pre code {
    @apply bg-transparent p-0;
  }
  .kh-editor table {
    @apply my-4 w-full border-collapse text-body;
  }
  .kh-editor li[data-item-type="task"] {
    @apply flex list-none gap-2;
  }
  .kh-editor li[data-item-type="task"]::before {
    content: "☐";
    @apply text-kh-text-muted;
  }
  .kh-editor li[data-item-type="task"][data-checked="true"]::before {
    content: "☑";
  }
  /* An empty document says what to do, as the old textarea's placeholder did. */
  .kh-editor > p:first-child:last-child:has(> br:only-child)::before {
    content: "Write here. Start with # to name the document.";
    @apply pointer-events-none float-left h-0 text-kh-text-muted;
  }

  /* The toolbar over a selection. Milkdown's tooltip sets `left`/`top` and `data-show`. */
  .kh-selection-toolbar {
    @apply absolute z-20 flex items-center rounded-lg border border-kh-border bg-kh-bg-raised p-1 shadow-popover;
  }
  .kh-selection-toolbar[data-show="false"] {
    @apply hidden;
  }
```

- [ ] **Step 3: The toolbar**

`src/components/knowledge/editor/selection-toolbar.ts`:

```ts
import { commandsCtx } from "@milkdown/kit/core";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { TooltipProvider, tooltipFactory } from "@milkdown/kit/plugin/tooltip";
import {
  liftListItemCommand,
  toggleEmphasisCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark";
import type { EditorView } from "@milkdown/kit/prose/view";
import { buttonClasses } from "@/components/ui/button";
import { fieldClasses } from "@/components/ui/field";

const tooltip = tooltipFactory("khSelectionToolbar");

function markActive(view: EditorView, name: string): boolean {
  const type = view.state.schema.marks[name];
  if (!type) return false;
  const { from, to, empty, $from } = view.state.selection;
  return empty ? Boolean(type.isInSet(view.state.storedMarks ?? $from.marks())) : view.state.doc.rangeHasMark(from, to, type);
}

function headingLevel(view: EditorView): number {
  const { parent } = view.state.selection.$from;
  return parent.type.name === "heading" ? Number(parent.attrs.level) : 0;
}

function inList(view: EditorView, name: "bullet_list" | "ordered_list"): boolean {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) if ($from.node(depth).type.name === name) return true;
  return false;
}

type Item = {
  label: string;
  text: string;
  className?: string;
  active: (view: EditorView) => boolean;
  run: (ctx: Ctx, view: EditorView, openLink: () => void) => void;
};

const items: Item[] = [
  { label: "Bold", text: "B", className: "font-bold", active: (view) => markActive(view, "strong"), run: (ctx) => ctx.get(commandsCtx).call(toggleStrongCommand.key) },
  { label: "Italic", text: "I", className: "italic", active: (view) => markActive(view, "emphasis"), run: (ctx) => ctx.get(commandsCtx).call(toggleEmphasisCommand.key) },
  {
    label: "Link",
    text: "Link",
    active: (view) => markActive(view, "link"),
    run: (ctx, view, openLink) => (markActive(view, "link") ? ctx.get(commandsCtx).call(toggleLinkCommand.key) : openLink()),
  },
  ...[1, 2].map<Item>((level) => ({
    label: `Heading ${level}`,
    text: `H${level}`,
    active: (view) => headingLevel(view) === level,
    run: (ctx, view) => {
      const commands = ctx.get(commandsCtx);
      if (headingLevel(view) === level) commands.call(turnIntoTextCommand.key);
      else commands.call(wrapInHeadingCommand.key, level);
    },
  })),
  {
    label: "Bulleted list",
    text: "•",
    active: (view) => inList(view, "bullet_list"),
    run: (ctx, view) => ctx.get(commandsCtx).call(inList(view, "bullet_list") ? liftListItemCommand.key : wrapInBulletListCommand.key),
  },
  {
    label: "Numbered list",
    text: "1.",
    active: (view) => inList(view, "ordered_list"),
    run: (ctx, view) => ctx.get(commandsCtx).call(inList(view, "ordered_list") ? liftListItemCommand.key : wrapInOrderedListCommand.key),
  },
];

/**
 * The toolbar that floats over a text selection (composer spec §11.4). Built
 * from the DOM because it lives inside a ProseMirror plugin, not React.
 *
 * Every button is `type="button"`: the editor sits inside the composer's
 * `<form>`, where the default type submits — that is, saves. `mousedown` is
 * cancelled on them so pressing one does not take the selection with it.
 */
export function selectionToolbar(): { plugins: MilkdownPlugin[]; configure: (ctx: Ctx) => void } {
  return {
    plugins: [tooltip].flat() as MilkdownPlugin[],
    configure: (ctx) => {
      ctx.set(tooltip.key, {
        view: (editorView) => {
          const element = document.createElement("div");
          element.className = "kh-selection-toolbar";
          element.setAttribute("role", "toolbar");
          element.setAttribute("aria-label", "Formatting");

          // One of the two rows is shown. Their whole class list is swapped rather than
          // toggling `hidden`, which a `flex` on the same element would override.
          const buttons = document.createElement("div");
          const linkRow = document.createElement("div");
          let linkMode = false;
          function setLinkMode(on: boolean) {
            linkMode = on;
            buttons.className = on ? "hidden" : "flex items-center gap-0.5";
            linkRow.className = on ? "flex items-center gap-1" : "hidden";
          }
          setLinkMode(false);
          element.append(buttons, linkRow);

          const pressers = items.map((item) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = buttonClasses({ variant: "ghost", size: "sm", className: item.className ?? "" });
            button.textContent = item.text;
            button.title = item.label;
            button.setAttribute("aria-label", item.label);
            button.addEventListener("mousedown", (event) => event.preventDefault());
            button.addEventListener("click", () => {
              item.run(ctx, editorView, openLink);
              if (!linkMode) editorView.focus();
            });
            buttons.appendChild(button);
            return { item, button };
          });

          const input = document.createElement("input");
          input.type = "url";
          input.placeholder = "https://";
          input.setAttribute("aria-label", "Link address");
          input.className = fieldClasses({ size: "sm", className: "w-56" });
          linkRow.appendChild(input);

          function showButtons() {
            setLinkMode(false);
            input.value = "";
          }
          function openLink() {
            setLinkMode(true);
            input.focus();
          }
          // Stops here: a bare Enter would submit the composer's form, and Esc would leave the page.
          input.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.isComposing) return;
            if (event.key === "Escape") {
              event.preventDefault();
              showButtons();
              editorView.focus();
            } else if (event.key === "Enter") {
              event.preventDefault();
              const href = input.value.trim();
              showButtons();
              editorView.focus();
              if (href) ctx.get(commandsCtx).call(toggleLinkCommand.key, { href });
            }
          });

          const provider = new TooltipProvider({ content: element, offset: 8 });
          provider.onHide = showButtons;

          return {
            update: (view, previous) => {
              for (const { item, button } of pressers) button.setAttribute("aria-pressed", String(item.active(view)));
              provider.update(view, previous);
            },
            destroy: () => {
              provider.destroy();
              element.remove();
            },
          };
        },
      });
    },
  };
}
```

- [ ] **Step 4: The React wrapper**

`src/components/knowledge/editor/rendered-editor.tsx`:

```tsx
"use client";

import { useEffect, useRef, type MouseEvent } from "react";
import { isAllowedMarkdownImageSrc } from "@/components/knowledge/markdown-image-policy";
import { MARKDOWN_PROSE } from "@/components/knowledge/markdown-prose";
import { createMarkdownEditor, type MarkdownEditor } from "./editor-core";
import { selectionToolbar } from "./selection-toolbar";

export type RenderedEditorProps = {
  /** What to open with. Later changes go in through the handle `onReady` gave. */
  markdown: string;
  editable: boolean;
  onReady: (editor: MarkdownEditor) => void;
  /** The editor could not be built (or made nothing of a non-empty document). */
  onFail: () => void;
  onUserEdit: () => void;
  onMarkdown: (markdown: string) => void;
};

/**
 * The rendered editing surface (composer spec §11). It is loaded with
 * `next/dynamic` and `ssr: false`, so Milkdown and ProseMirror stay out of the
 * first bundle and never run on the server.
 *
 * It builds the editor once. Props other than `editable` are read through a ref
 * at the moment they are needed, so a re-render never rebuilds the editor.
 */
export function RenderedEditor(props: RenderedEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MarkdownEditor | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Its own host, so the two editors a Strict Mode double-mount briefly
    // builds never share a node, and the loser leaves nothing behind.
    const host = document.createElement("div");
    container.appendChild(host);
    let cancelled = false;
    const toolbar = selectionToolbar();
    createMarkdownEditor({
      root: host,
      markdown: latest.current.markdown,
      className: `kh-editor ${MARKDOWN_PROSE}`,
      ariaLabel: "Content",
      editable: latest.current.editable,
      onUserEdit: () => latest.current.onUserEdit(),
      onMarkdown: (markdown) => latest.current.onMarkdown(markdown),
      allowImage: (src) => isAllowedMarkdownImageSrc(src, { origin: window.location.origin }),
      extraPlugins: toolbar.plugins,
      configure: toolbar.configure,
    }).then(
      (editor) => {
        if (cancelled) {
          void editor.destroy();
          return;
        }
        editorRef.current = editor;
        latest.current.onReady(editor);
      },
      () => {
        if (!cancelled) latest.current.onFail();
      },
    );
    return () => {
      cancelled = true;
      const editor = editorRef.current;
      editorRef.current = null;
      if (editor) void editor.destroy();
      host.remove();
    };
  }, []);

  useEffect(() => {
    editorRef.current?.setEditable(props.editable);
  }, [props.editable]);

  // A plain click on a link edits the text around it; ⌘/Ctrl-click follows it, as the reader's links do.
  function followLinkOnModifierClick(event: MouseEvent<HTMLDivElement>) {
    if (!(event.metaKey || event.ctrlKey)) return;
    const link = (event.target as HTMLElement).closest("a");
    const href = link?.getAttribute("href");
    if (!href) return;
    event.preventDefault();
    window.open(href, "_blank", "noopener,noreferrer");
  }

  return <div ref={containerRef} onClick={followLinkOnModifierClick} />;
}
```

- [ ] **Step 5: Verify**

```bash
export PATH=/Users/chuntsai/.nvm/versions/node/v24.6.0/bin:$PATH
make verify > .superpowers/t2verify.log 2>&1; echo "VERIFY_EXIT=$?"; grep -E "error|Error" .superpowers/t2verify.log | head -10
```

Expected: `VERIFY_EXIT=0` (unit tests, typecheck, lint, build). The build must succeed although nothing imports the new files yet. If `tsc` reports a type error in one of the Milkdown calls, fix the type minimally and keep the behaviour; say so in the report.

- [ ] **Step 6: Commit**

```bash
git add src/components/knowledge/markdown-prose.ts src/components/knowledge/markdown-renderer.tsx src/components/knowledge/editor/selection-toolbar.ts src/components/knowledge/editor/rendered-editor.tsx src/app/globals.css
git commit -m "feat(editor): the selection toolbar, the React wrapper, and the reader's prose classes shared

Claude-Session: https://claude.ai/code/session_0147bSAtofdFgcV3oVdWtipa"
```

---

### Task 3: The composer edits rendered content — the browser gate

This is where Milkdown first runs in a browser. **It is a gate**: if the editor cannot be made to mount cleanly (console or hydration errors, two editors under Strict Mode, the toolbar mispositioned or clipped in the reading column) or the new tests cannot be made stable, **stop and report BLOCKED with the evidence.** The fallback is the Markdown-source editor already on this branch: revert Tasks 2–3.

**Files:**
- Modify: `src/lib/form-keys.ts`, `tests/unit/form-keys.test.ts`, `src/components/knowledge/use-form-keys.ts`
- Modify: `src/components/knowledge/document-composer.tsx` (whole file)
- Create: `tests/e2e/composer-helpers.ts`
- Modify: `tests/e2e/document-composer.spec.ts` (whole file)

**Interfaces:**
- Consumes: Task 1 `MarkdownEditor`; Task 2 `RenderedEditor`, `RenderedEditorProps`.
- Produces: `formKeyIntent(event, state: { dirty; busy; canToggleMode }): "save" | "toggle-mode" | "cancel" | null`; `useFormKeys({ dirty, busy, onCancel, mode? }: { …; mode?: { toggle: () => void } })`; `showMarkdown(form: Locator): Promise<Locator>` (used by Task 4).

- [ ] **Step 1: Record the bundle before**

```bash
export PATH=/Users/chuntsai/.nvm/versions/node/v24.6.0/bin:$PATH
git stash list | head -1   # expect nothing
make build > .superpowers/build-before.log 2>&1; echo "BUILD_EXIT=$?"; grep -E "knowledge/\[sourceId\]/\[documentId\]/edit|knowledge/new" .superpowers/build-before.log
```

Write the two `First Load JS` figures (edit page, new page) in the report. The composer is not yet importing the editor, so these are the baseline.

- [ ] **Step 2: Form keys — write the failing test**

Replace `tests/unit/form-keys.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { formKeyIntent, type FormKeyEvent } from "@/lib/form-keys";

function key(overrides: Partial<FormKeyEvent> = {}): FormKeyEvent {
  return { key: "a", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, isComposing: false, keyCode: 65, ...overrides };
}

const editing = { dirty: false, busy: false, canToggleMode: true };

describe("formKeyIntent", () => {
  it("saves on ⌘Enter and Ctrl Enter", () => {
    expect(formKeyIntent(key({ key: "Enter", metaKey: true }), editing)).toBe("save");
    expect(formKeyIntent(key({ key: "Enter", ctrlKey: true }), editing)).toBe("save");
  });

  it("does nothing while an input method is composing", () => {
    expect(formKeyIntent(key({ key: "Enter", metaKey: true, isComposing: true }), editing)).toBeNull();
    expect(formKeyIntent(key({ key: "Escape", keyCode: 229 }), editing)).toBeNull();
    expect(formKeyIntent(key({ key: "/", metaKey: true, isComposing: true }), editing)).toBeNull();
  });

  it("toggles rendered ⇄ Markdown on ⌘/ and Ctrl /", () => {
    expect(formKeyIntent(key({ key: "/", metaKey: true }), editing)).toBe("toggle-mode");
    expect(formKeyIntent(key({ key: "/", ctrlKey: true }), editing)).toBe("toggle-mode");
    // Some layouts type "/" with Shift.
    expect(formKeyIntent(key({ key: "/", metaKey: true, shiftKey: true }), editing)).toBe("toggle-mode");
  });

  it("leaves a bare slash, ⌥⌘/ and a form without modes alone", () => {
    expect(formKeyIntent(key({ key: "/" }), editing)).toBeNull();
    expect(formKeyIntent(key({ key: "/", metaKey: true, altKey: true }), editing)).toBeNull();
    expect(formKeyIntent(key({ key: "/", metaKey: true }), { ...editing, canToggleMode: false })).toBeNull();
  });

  it("no longer answers to ⌘⇧P", () => {
    expect(formKeyIntent(key({ key: "p", metaKey: true, shiftKey: true }), editing)).toBeNull();
  });

  it("uses Esc to leave only an unchanged, idle form", () => {
    expect(formKeyIntent(key({ key: "Escape" }), editing)).toBe("cancel");
    expect(formKeyIntent(key({ key: "Escape" }), { ...editing, dirty: true })).toBeNull();
    expect(formKeyIntent(key({ key: "Escape" }), { ...editing, busy: true })).toBeNull();
  });

  it("ignores every other key", () => {
    expect(formKeyIntent(key({ key: "e" }), editing)).toBeNull();
    expect(formKeyIntent(key({ key: "Enter" }), editing)).toBeNull();
  });
});
```

Run: `node_modules/.bin/vitest run --config vitest.config.ts tests/unit/form-keys.test.ts > .superpowers/t3a.log 2>&1; echo "EXIT=$?"` (with the PATH export). Expected `EXIT=1` (type/behaviour mismatch: `canToggleMode`, `toggle-mode` do not exist yet).

- [ ] **Step 3: Form keys — implement**

`src/lib/form-keys.ts`:

```ts
export type FormKeyEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  keyCode: number;
};

export type FormKeyIntent = "save" | "toggle-mode" | "cancel" | null;

/**
 * What a key pressed inside a document form asks for. Keyboard shortcuts spec
 * §5; composer spec §11.6. ⌘/Ctrl / switches between the rendered editor and
 * the Markdown source. Esc never discards changes: it leaves only a form
 * nothing has been typed into.
 */
export function formKeyIntent(
  event: FormKeyEvent,
  state: { dirty: boolean; busy: boolean; canToggleMode: boolean },
): FormKeyIntent {
  // An input method uses Enter and Esc to finish or abandon a composition.
  if (event.isComposing || event.keyCode === 229) return null;
  const command = event.metaKey || event.ctrlKey;
  if (command && event.key === "Enter") return "save";
  if (command && !event.altKey && event.key === "/") return state.canToggleMode ? "toggle-mode" : null;
  if (event.key !== "Escape") return null;
  return !state.dirty && !state.busy ? "cancel" : null;
}
```

`src/components/knowledge/use-form-keys.ts`:

```ts
"use client";

import type { KeyboardEvent } from "react";
import { formKeyIntent } from "@/lib/form-keys";

/**
 * ⌘Enter saves, ⌘/ switches rendered ⇄ Markdown and Esc cancels, inside a
 * document form. The rules are `formKeyIntent`'s; this only carries them out.
 *
 * Saving goes through the form's own submit button and only when that button
 * is enabled: `requestSubmit()` ignores a disabled button, so checking it here
 * is what keeps "not hydrated yet", "saving", "access unconfirmed" and "no
 * title" (all already on the button) from being restated.
 */
export function useFormKeys({
  dirty,
  busy,
  onCancel,
  mode,
}: {
  dirty: boolean;
  busy: boolean;
  onCancel: () => void;
  mode?: { toggle: () => void };
}) {
  return (event: KeyboardEvent<HTMLFormElement>) => {
    const intent = formKeyIntent(
      {
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        isComposing: event.nativeEvent.isComposing,
        keyCode: event.keyCode,
      },
      { dirty, busy, canToggleMode: mode !== undefined },
    );
    if (intent === null) return;
    if (intent === "save") {
      const submit = event.currentTarget.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (!submit || submit.disabled) return;
      event.preventDefault();
      event.currentTarget.requestSubmit(submit);
      return;
    }
    event.preventDefault();
    if (intent === "cancel") onCancel();
    else mode?.toggle();
  };
}
```

Run the unit test again: expected `EXIT=0`, 7 tests.

- [ ] **Step 4: The composer**

Replace `src/components/knowledge/document-composer.tsx` with:

```tsx
"use client";

import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/shell/use-hydrated";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { refreshOnArrival } from "@/components/shell/refresh-on-arrival";
import { GovernanceError, governanceFailure, type GovernanceFailure } from "@/components/workspaces/governance-error";
import { carryTitle, resolveAuthoredTitle } from "@/lib/authored-title";
import { browserDraftStorage, clearDraft, readDraft, syncDraft, type DraftKey } from "@/lib/document-draft";
import { markdownOpensWithHeading } from "@/lib/markdown-title";
import { DocumentBreadcrumb, type DocumentBreadcrumbSegment } from "./document-breadcrumb";
import { MarkdownArticle } from "./document-viewer";
import type { MarkdownEditor } from "./editor/editor-core";
import { useFormKeys } from "./use-form-keys";

// Loaded on demand and never on the server: Milkdown and ProseMirror stay out of the first bundle.
const RenderedEditor = dynamic(() => import("./editor/rendered-editor").then((module) => module.RenderedEditor), { ssr: false });

type Mode = "rendered" | "source";

/** How long a successful save waits for the client navigation before a full load. */
const ARRIVAL_GRACE_MS = 3_000;

function fitHeight(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

export type ComposerSubmit = { title: string; markdown: string; expectedRevisionId: string | null };

/**
 * Writing a document, laid out like reading one (composer spec). The header row
 * is the reader's with the actions swapped; the column is the reader's with the
 * article swapped for an editor: the rendered document by default, its Markdown
 * source on request (spec §11). `markdown` is the only state either edits.
 * Everything that decides something lives in `lib/`: the title in
 * `authored-title`, the draft in `document-draft`, the keys in `form-keys`.
 */
export function DocumentComposer({
  draftKey,
  location,
  untitledLabel,
  metadataTitle,
  initialTitle,
  initialMarkdown,
  currentRevisionId,
  submitLabel,
  cancelHref,
  onSubmit,
  conflictHref,
  blocked,
  footer,
}: {
  draftKey: DraftKey;
  /** Breadcrumb up to, not including, the document; the resolved title is appended. */
  location: DocumentBreadcrumbSegment[];
  /** The last breadcrumb segment while nothing supplies a title. */
  untitledLabel: string;
  metadataTitle: unknown;
  initialTitle: string;
  initialMarkdown: string;
  /** The revision this editor opened on; null when creating. */
  currentRevisionId: string | null;
  submitLabel: string;
  cancelHref: string;
  /** Sends the document and returns where it now lives; throws on refusal. */
  onSubmit: (input: ComposerSubmit) => Promise<string>;
  /** Where "load the latest version" goes after a conflict; null when creating. */
  conflictHref: string | null;
  /** Another operation owns the page, e.g. an upload; nothing here may start. */
  blocked?: boolean;
  footer?: (state: { busy: boolean }) => ReactNode;
}) {
  const router = useRouter();
  const { confirmed } = useWorkspaceAuthorization();
  // Everything waits for hydration; see `use-hydrated` for what a native submit costs.
  const hydrated = useHydrated();
  const [title, setTitle] = useState(initialTitle);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [baseRevisionId, setBaseRevisionId] = useState(currentRevisionId);
  const [restored, setRestored] = useState<"current" | "stale" | null>(null);
  const [restoreChecked, setRestoreChecked] = useState(false);
  const [mode, setMode] = useState<Mode>("rendered");
  // A change made in the rendered editor. Counts as a modification at once, before its output arrives.
  const [touched, setTouched] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [editorFailed, setEditorFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GovernanceFailure | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<MarkdownEditor | null>(null);
  // The Markdown the rendered editor last showed or produced; if `markdown` differs, the editor is out of date.
  const syncedRef = useRef(initialMarkdown);
  // Typed into the editor and not yet delivered as Markdown (its output is debounced).
  const pendingRef = useRef(false);
  const restoreTried = useRef(false);
  const focusedOnce = useRef(false);
  const leaving = useRef(false);
  const arrivalGuard = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(arrivalGuard.current), []);

  // A failed editor leaves the Markdown source, which always works.
  const showing: Mode = editorFailed ? "source" : mode;
  const resolved = resolveAuthoredTitle({ metadataTitle, markdown, typedTitle: title });
  const dirty = title !== initialTitle || markdown !== initialMarkdown || touched;
  // Fields wait for the restore check too: enabling them the instant
  // hydration commits, before sessionStorage has been read, lets a keystroke
  // land in the gap and then be overwritten by a draft arriving a tick later.
  const interactive = hydrated && restoreChecked && !busy && !blocked;
  // Rendered editing also waits for its editor: a title field that is editable
  // before Save can act would let ⌘Enter do nothing.
  const ready = interactive && (showing === "source" || editorReady);
  const mountEditor = hydrated && restoreChecked && !editorFailed;
  const initial = { title: initialTitle, markdown: initialMarkdown };

  // Once, after hydration: the server has no sessionStorage, and anything set
  // before hydration commits is overwritten by the server's values.
  useEffect(() => {
    if (!hydrated || restoreTried.current) return;
    restoreTried.current = true;
    const draft = readDraft(browserDraftStorage(), draftKey);
    if (draft) {
      setTitle(draft.title);
      setMarkdown(draft.markdown);
      setBaseRevisionId(draft.baseRevisionId);
      setRestored(draft.baseRevisionId === currentRevisionId ? "current" : "stale");
    }
    setRestoreChecked(true);
  }, [hydrated, draftKey, currentRevisionId]);

  // Closing the tab loses sessionStorage; reloading does not, but the browser
  // cannot tell the two apart, so both ask.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!leaving.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // First focus: an empty title field when one is shown, else the start of the
  // text. Later: whichever surface is showing. Both wait until they can take it:
  // focusing a disabled field, or an editor still loading, does nothing, and
  // this effect must run again once they can.
  useEffect(() => {
    if (!hydrated || !restoreChecked) return;
    const rendered = showing === "rendered";
    if (rendered && !editorReady) return;
    const first = !focusedOnce.current;
    focusedOnce.current = true;
    if (first && titleRef.current && !titleRef.current.value) {
      titleRef.current.focus();
      return;
    }
    if (rendered) {
      if (first) editorRef.current?.focusStart();
      else editorRef.current?.focus();
      return;
    }
    const textarea = textareaRef.current;
    textarea?.focus();
    if (first) textarea?.setSelectionRange(0, 0);
  }, [hydrated, restoreChecked, showing, editorReady]);

  // The Markdown text grows with its content, so the page scrolls, not a box inside it.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea && showing === "source") fitHeight(textarea);
  }, [markdown, showing]);

  // Rewrapping changes the height too — a narrower window, a web font that
  // arrives after first layout. The textarea hides its overflow, so without
  // this the lines past the old height are clipped until the next keystroke.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || showing !== "source") return;
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === width) return;
      width = textarea.clientWidth;
      fitHeight(textarea);
    });
    observer.observe(textarea);
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) fitHeight(textarea);
    });
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [showing]);

  // Anything that changed `markdown` from outside the rendered editor (a
  // discarded draft, an edit made in the source) reaches the editor here. Not
  // while the person has typed something the editor has not delivered yet.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !editorReady || showing !== "rendered" || pendingRef.current) return;
    if (markdown !== syncedRef.current) {
      editor.replaceMarkdown(markdown);
      syncedRef.current = markdown;
    }
  }, [markdown, showing, editorReady]);

  function keep(nextTitle: string, nextMarkdown: string) {
    syncDraft(browserDraftStorage(), draftKey, { title: nextTitle, markdown: nextMarkdown, baseRevisionId }, initial);
  }

  function applyMarkdown(next: string): { markdown: string; title: string } {
    const after = resolveAuthoredTitle({ metadataTitle, markdown: next, typedTitle: title });
    const nextTitle = carryTitle(resolved, after, title);
    setMarkdown(next);
    setTitle(nextTitle);
    keep(nextTitle, next);
    return { markdown: next, title: nextTitle };
  }

  function changeTitle(next: string) {
    setTitle(next);
    keep(next, markdown);
  }

  // The rendered editor's output becomes `markdown`.
  function adopt(next: string): { markdown: string; title: string } {
    syncedRef.current = next;
    pendingRef.current = false;
    if (next === initialMarkdown) setTouched(false);
    return next === markdown ? { markdown, title } : applyMarkdown(next);
  }

  // Brings `markdown` up to date with what was typed, now rather than after the debounce.
  function flush(): { markdown: string; title: string } {
    const editor = editorRef.current;
    if (leaving.current || !editor || !pendingRef.current) return { markdown, title };
    return adopt(editor.getMarkdown());
  }

  function handleEditorReady(editor: MarkdownEditor) {
    editorRef.current = editor;
    syncedRef.current = markdown;
    setEditorReady(true);
  }

  function handleEditorFail() {
    editorRef.current = null;
    pendingRef.current = false;
    setEditorReady(false);
    setEditorFailed(true);
  }

  function handleUserEdit() {
    pendingRef.current = true;
    setTouched(true);
  }

  function discardDraft() {
    clearDraft(browserDraftStorage(), draftKey);
    pendingRef.current = false;
    setTouched(false);
    setTitle(initialTitle);
    setMarkdown(initialMarkdown);
    setBaseRevisionId(currentRevisionId);
    setRestored(null);
  }

  function cancel() {
    if (dirty && !window.confirm("Discard changes?")) return;
    pendingRef.current = false;
    clearDraft(browserDraftStorage(), draftKey);
    leaving.current = true;
    leave(cancelHref);
  }

  // The router now and then drops a client navigation from `/edit` back to
  // its document after the response has arrived — measured on main as well,
  // with the old editor (composer verification record). Leaving is already
  // decided when this runs (saved, or discarded), so if this component is
  // still mounted after a grace period, finish with a full load instead of
  // leaving a stranded editor behind. Unmounting on arrival cancels it.
  function leave(href: string) {
    router.push(href);
    arrivalGuard.current = window.setTimeout(() => window.location.assign(href), ARRIVAL_GRACE_MS);
  }

  function loadLatest() {
    if (!conflictHref) return;
    clearDraft(browserDraftStorage(), draftKey);
    leaving.current = true;
    window.location.assign(conflictHref);
  }

  async function save() {
    if (busy || !confirmed || !ready) return;
    // What was typed a moment ago has not reached `markdown` yet; save what is there.
    const snapshot = flush();
    const final = resolveAuthoredTitle({ metadataTitle, markdown: snapshot.markdown, typedTitle: snapshot.title });
    if (!final.title) return;
    setBusy(true);
    setError(null);
    try {
      const href = await onSubmit({ title: final.title, markdown: snapshot.markdown, expectedRevisionId: baseRevisionId });
      clearDraft(browserDraftStorage(), draftKey);
      leaving.current = true;
      // Push only, then refresh on arrival: a refresh fired beside the push
      // discards it (keyboard-shortcuts spec §9, #49).
      refreshOnArrival(href);
      leave(href);
    } catch (failure) {
      setError(governanceFailure(failure));
      setBusy(false);
    }
    // No finally: on success the page is navigating away, and re-enabling
    // the fields would let a keystroke land between the PATCH and the
    // navigation, rewriting the draft against a base revision already
    // superseded by the save that just happened.
  }

  function toggleMode() {
    if (editorFailed) return;
    // Going to the source: what is in the editor becomes `markdown` first.
    // Coming back, the effect above brings the editor up to date.
    if (showing === "rendered") flush();
    setMode(showing === "rendered" ? "source" : "rendered");
  }

  // Typed text is kept as a draft even if the tab is hidden or closed within the
  // debounce. The editor may already be gone when this runs on unmount.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const persist = () => {
      try {
        flushRef.current();
      } catch {
        // The editor was destroyed first; its last delivered output was already kept.
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") persist();
    };
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", onVisibility);
      persist();
    };
  }, []);

  const onKeyDown = useFormKeys({ dirty, busy, onCancel: cancel, mode: { toggle: toggleMode } });

  // Plain Enter in a single-line title field would otherwise submit the form
  // natively; ⌘/Ctrl Enter still reaches useFormKeys's save handling above.
  function onTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.metaKey || event.ctrlKey) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (showing === "rendered") editorRef.current?.focusStart();
    else textareaRef.current?.focus();
  }
  const conflict = error?.code === "REVISION_CONFLICT";
  const untitled = !resolved.title;

  return (
    <>
      <form onKeyDown={onKeyDown} onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="kh-reading-column pb-3 pt-5">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <DocumentBreadcrumb segments={[...location, { label: resolved.title || untitledLabel }]} />
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                aria-pressed={showing === "source"}
                aria-keyshortcuts="Meta+/ Control+/"
                title={editorFailed ? "Rendered editing is not available for this document" : "Show Markdown source (⌘/)"}
                className="aria-pressed:bg-kh-bg-selected aria-pressed:text-kh-text"
                disabled={!hydrated || editorFailed}
                onClick={toggleMode}
              >
                Markdown
              </Button>
              <Button type="button" variant="secondary" title="Cancel (Esc)" disabled={busy || blocked} onClick={cancel}>
                Cancel
              </Button>
              <Button
                type="submit"
                title={untitled ? "Add a title, or start the document with a # heading" : `${submitLabel} (⌘Enter)`}
                disabled={!ready || !confirmed || untitled}
              >
                {submitLabel}
              </Button>
            </div>
          </div>
          {resolved.source === "METADATA" ? (
            <p className="mt-1.5 text-caption text-kh-text-muted">標題來自上傳檔案的 frontmatter</p>
          ) : null}
        </div>
        <div className="kh-reading-column space-y-4 py-6">
          {restored ? (
            <p role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-kh-border bg-kh-bg-subtle px-3 py-2 text-body text-kh-text">
              {restored === "stale" ? "這份文件在你離開後被更新過，已還原你未存的修改。" : "已還原未存的修改。"}
              <Button type="button" variant="link" onClick={discardDraft}>捨棄</Button>
            </p>
          ) : null}
          {editorFailed ? (
            <p role="status" className="rounded-md border border-kh-border bg-kh-bg-subtle px-3 py-2 text-body text-kh-text">
              這份文件的排版無法在渲染模式下編輯，已改用 Markdown 模式。
            </p>
          ) : null}
          {conflict ? (
            <div role="alert" className="rounded-md border border-kh-border bg-kh-bg-subtle px-3 py-2 text-body text-kh-text">
              這份文件已被其他人更新。你的輸入仍保留在表單中。
              <Button type="button" variant="link" className="ml-2" onClick={loadLatest}>載入最新版本（捨棄你的修改）</Button>
            </div>
          ) : (
            <GovernanceError error={error} />
          )}
          {resolved.source === "TYPED" ? (
            <input
              ref={titleRef}
              aria-label="Title"
              placeholder="Title"
              value={title}
              maxLength={512}
              disabled={!ready}
              onChange={(event) => changeTitle(event.target.value)}
              onKeyDown={onTitleKeyDown}
              className="w-full border-0 bg-transparent p-0 text-heading font-semibold tracking-tight text-kh-text outline-none placeholder:text-kh-text-muted"
            />
          ) : null}
          {/* The reader's rule: a title above the content unless the content opens with its own heading.
              TYPED has the title field above; METADATA has neither. */}
          {showing === "rendered" && resolved.source === "METADATA" && !markdownOpensWithHeading(markdown) ? (
            <h1 className="text-heading font-semibold tracking-tight text-kh-text">{resolved.title}</h1>
          ) : null}
          {/* Until the editor is ready the reader's own rendering stands in for it, so nothing flashes. */}
          {showing === "rendered" && !editorReady ? <MarkdownArticle markdown={markdown} /> : null}
          {mountEditor ? (
            <div hidden={showing !== "rendered" || !editorReady}>
              <RenderedEditor
                markdown={markdown}
                editable={interactive}
                onReady={handleEditorReady}
                onFail={handleEditorFail}
                onUserEdit={handleUserEdit}
                onMarkdown={adopt}
              />
            </div>
          ) : null}
          {/* No display utility here: it would override [hidden]. */}
          <textarea
            ref={textareaRef}
            aria-label="Markdown"
            placeholder="Write in Markdown. Start with # to name the document."
            value={markdown}
            disabled={!interactive}
            hidden={showing !== "source"}
            onChange={(event) => applyMarkdown(event.target.value)}
            className="min-h-[12rem] w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-reading text-kh-text outline-none placeholder:text-kh-text-muted"
          />
        </div>
      </form>
      {footer ? <div className="kh-reading-column pb-6">{footer({ busy })}</div> : null}
    </>
  );
}
```

Then `node_modules/.bin/tsc --noEmit` and `node_modules/.bin/eslint src/components/knowledge/document-composer.tsx src/components/knowledge/use-form-keys.ts src/lib/form-keys.ts`. Expected: clean. If `tsc` reports a small type error (for example the `onMarkdown={adopt}` return type), fix it without changing behaviour and note it.

- [ ] **Step 5: The e2e helper**

`tests/e2e/composer-helpers.ts`:

```ts
import { expect, type Locator } from "@playwright/test";

/**
 * The composer opens in rendered editing. Tests that need to type exact
 * Markdown switch to the source first; this does that and returns the textarea.
 */
export async function showMarkdown(form: Locator): Promise<Locator> {
  const toggle = form.getByRole("button", { name: "Markdown", exact: true });
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  const source = form.getByLabel("Markdown", { exact: true });
  await expect(source).toBeVisible();
  return source;
}
```

- [ ] **Step 6: Rewrite the composer spec**

Replace `tests/e2e/document-composer.spec.ts` with:

```ts
import { expect, test, type Dialog, type Page } from "@playwright/test";
import { showMarkdown } from "./composer-helpers";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS (Playwright cannot resolve `@/` aliases).
const EMPTY_WORKSPACE = "0199f100-0000-7000-8000-000000000004";
// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/** Unique per call: the workspace is shared across tests and repeats. */
function unique(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** main form + first(): the duplicate-DOM quirk phase5-authoring.spec.ts documents. */
function composer(page: Page) {
  return page.locator("main form").first();
}

/** The rendered editing surface. */
function surfaceOf(page: Page) {
  return composer(page).getByRole("textbox", { name: "Content" });
}

/**
 * Creates a note through the API and returns its URL. Not through the
 * new-document page: these tests are about editing, and must not depend on
 * how that page looks.
 */
async function createNote(page: Page, title: string, markdown = "") {
  const response = await page.request.post(`/api/workspaces/${EMPTY_WORKSPACE}/documents`, { data: { title, markdown } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  return `/w/${EMPTY_WORKSPACE}/knowledge/${created.sourceId}/${created.documentId}`;
}

/**
 * Leaves a dirty editor for the document page by a full load, accepting the
 * `beforeunload` prompt the dirty editor raises. Not by clicking the sidebar:
 * a client navigation from `/edit` to its document is sometimes dropped by the
 * router after its response arrives — on `main` too, with the old editor (see
 * the composer verification record). These tests are about the draft, which
 * survives any way of leaving; that defect is tracked on its own.
 */
async function leaveEditor(page: Page, documentUrl: string) {
  const accept = (dialog: Dialog) => void dialog.accept();
  page.on("dialog", accept);
  await page.goto(documentUrl);
  page.off("dialog", accept);
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
}

/** Opens the editor and returns the rendered surface once it can be typed into. */
async function openEditor(page: Page, documentUrl: string) {
  await page.goto(`${documentUrl}/edit`);
  const surface = surfaceOf(page);
  await expect(surface).toBeEditable(ROUND_TRIP);
  return surface;
}

test("the rendered editor mounts without hydration or page errors", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    const text = message.text();
    if ((message.type() === "error" && !/Failed to load resource/.test(text)) || /hydrat/i.test(text)) problems.push(text);
  });
  const url = await createNote(page, unique("Clean Mount"), "# Clean\n\nbody with **bold**");
  const surface = await openEditor(page, url);
  await expect(surface.locator("strong")).toHaveText("bold");
  await page.waitForTimeout(1_000);
  expect(problems).toEqual([]);
  // Strict Mode builds two editors while developing; a production build must hold exactly one.
  await expect(page.locator(".ProseMirror")).toHaveCount(1);
});

test("focus lands in Title on a new document, and at the start of the content for an H1-led one", async ({ page }) => {
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  await expect(composer(page).getByLabel("Title", { exact: true })).toBeFocused(ROUND_TRIP);

  const title = unique("Focus H1");
  const url = await createNote(page, title, `# ${title}\n\nbody`);
  const surface = await openEditor(page, url);
  await expect(surface).toBeFocused(ROUND_TRIP);
  await page.keyboard.type("X");
  const source = await showMarkdown(composer(page));
  await expect(source).toHaveValue(`# X${title}\n\nbody\n`);
});

test("a document opens rendered, and its Markdown is shown untouched", async ({ page }) => {
  const markdown = "# Shown\n\nSome **bold** words\n\n* star item\n";
  const url = await createNote(page, unique("Shown"), markdown);
  const surface = await openEditor(page, url);
  await expect(surface.locator("strong")).toHaveText("bold");

  const source = await showMarkdown(composer(page));
  // Opening rewrites nothing, not even the * list the editor would write as -.
  await expect(source).toHaveValue(markdown);

  await composer(page).getByRole("button", { name: "Markdown", exact: true }).click();
  await expect(surface).toBeVisible();
  await expect(surface.locator("strong")).toHaveText("bold");
});

test("saving without a change keeps the Markdown exactly as it was", async ({ page }) => {
  const markdown = "* one\n* two\n";
  const url = await createNote(page, unique("Untouched"), markdown);
  await openEditor(page, url);
  await composer(page).getByRole("button", { name: "Save" }).click();
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);

  await openEditor(page, url);
  const source = await showMarkdown(composer(page));
  await expect(source).toHaveValue(markdown);
});

test("an untouched rendered editor is not a modification: Esc leaves it", async ({ page }) => {
  const url = await createNote(page, unique("Not Dirty"), "# Not dirty\n\n* a\n* b\n");
  const surface = await openEditor(page, url);
  await surface.press("Escape");
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
});

test("typing Markdown syntax writes a heading and a list, and Create saves it", async ({ page }) => {
  const title = unique("Typed Heading");
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  const surface = surfaceOf(page);
  await expect(surface).toBeEditable(ROUND_TRIP);
  await surface.click();
  await page.keyboard.type(`# ${title}`);
  await page.keyboard.press("Enter");
  await page.keyboard.type("- one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("two");

  await expect(surface.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(surface.getByRole("listitem")).toHaveCount(2);
  await expect(composer(page).getByLabel("Title", { exact: true })).toHaveCount(0);
  const source = await showMarkdown(composer(page));
  await expect(source).toHaveValue(`# ${title}\n\n- one\n- two\n`);

  await composer(page).getByRole("button", { name: "Create document" }).click();
  await expect(page.getByRole("treeitem", { name: title, exact: true })).toBeVisible(ROUND_TRIP);
});

test("⌘Enter saves from inside the rendered editor", async ({ page }) => {
  const title = unique("Save Shortcut");
  const url = await createNote(page, title, `# ${title}\n\nbody\n`);
  const surface = await openEditor(page, url);
  await surface.click();
  await page.keyboard.type("more ");
  await surface.press("ControlOrMeta+Enter");
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
  await expect(page.locator("article").first().getByText("more")).toBeVisible(ROUND_TRIP);
});

test("selecting text shows the toolbar, and Bold writes ** into the Markdown", async ({ page }) => {
  const url = await createNote(page, unique("Toolbar"), "hello world\n");
  const surface = await openEditor(page, url);
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  await expect(toolbar).toBeHidden();

  await surface.locator("p").selectText();
  await expect(toolbar).toBeVisible(ROUND_TRIP);
  const box = await toolbar.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);

  await toolbar.getByRole("button", { name: "Bold" }).click();
  // A toolbar button must not submit the form it sits in.
  await expect(page).toHaveURL(/\/edit$/);
  await expect(surface.locator("strong")).toHaveText("hello world");
  await expect(toolbar.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
  const source = await showMarkdown(composer(page));
  await expect(source).toHaveValue("**hello world**\n");
});

test("the toolbar adds a link from an address typed into it", async ({ page }) => {
  const url = await createNote(page, unique("Link"), "hello world\n");
  const surface = await openEditor(page, url);
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  await surface.locator("p").selectText();
  await toolbar.getByRole("button", { name: "Link" }).click();
  const address = toolbar.getByLabel("Link address");
  await expect(address).toBeFocused();
  await address.fill("https://example.com");
  await address.press("Enter");

  // Enter in the address box must neither save the document nor leave the page.
  await expect(page).toHaveURL(/\/edit$/);
  await expect(surface.locator('a[href="https://example.com"]')).toHaveText("hello world");
  const source = await showMarkdown(composer(page));
  await expect(source).toHaveValue("[hello world](https://example.com)\n");
});

test("changes made in the Markdown show when switching back", async ({ page }) => {
  const url = await createNote(page, unique("Back"), "old\n");
  const surface = await openEditor(page, url);
  const source = await showMarkdown(composer(page));
  await source.fill("# Changed heading\n\nnew body\n");
  await composer(page).getByRole("button", { name: "Markdown", exact: true }).click();
  await expect(surface.getByRole("heading", { level: 1 })).toHaveText("Changed heading");
  await expect(surface).toContainText("new body");
});

test("⌘/ switches between the rendered editor and the Markdown", async ({ page }) => {
  const url = await createNote(page, unique("Shortcut"), "text\n");
  const surface = await openEditor(page, url);
  await surface.press("ControlOrMeta+/");
  const source = composer(page).getByLabel("Markdown", { exact: true });
  await expect(source).toBeVisible();
  await source.press("ControlOrMeta+/");
  await expect(surface).toBeVisible();
});

test("an image the reader would refuse is not loaded by the editor either", async ({ page }) => {
  const markdown = "![x](https://evil.example/a.png)\n\nbody\n";
  const url = await createNote(page, unique("Image"), markdown);
  const surface = await openEditor(page, url);
  await expect(surface.locator('img[src="https://evil.example/a.png"]')).toHaveCount(0);
  // The document still holds the address; only the element lost it.
  const source = await showMarkdown(composer(page));
  await expect(source).toHaveValue(markdown);
});

test("a document that opens with an H1 is named by it, with no title field", async ({ page }) => {
  const before = unique("Composer H1");
  const after = unique("Composer Renamed");
  const url = await createNote(page, before, `# ${before}\n\nbody`);
  await openEditor(page, url);
  await expect(composer(page).getByLabel("Title", { exact: true })).toHaveCount(0);

  const source = await showMarkdown(composer(page));
  await source.fill(`# ${after}\n\nbody`);
  await expect(composer(page).getByRole("navigation", { name: "Breadcrumb" })).toContainText(after);
  await composer(page).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("treeitem", { name: after, exact: true })).toBeVisible(ROUND_TRIP);
});

test("deleting the opening H1 brings back the title field, filled with it", async ({ page }) => {
  const title = unique("Carry");
  const url = await createNote(page, title, `# ${title}\n\nbody`);
  await openEditor(page, url);
  const source = await showMarkdown(composer(page));
  // Change the H1 away from the stored title first, so a no-op carryTitle
  // (one that just leaves the stored title alone) cannot pass this test.
  const changedHeading = unique("Carry Changed");
  await source.fill(`# ${changedHeading}\n\nbody`);
  await expect(composer(page).getByLabel("Title", { exact: true })).toHaveCount(0);

  await source.fill("body");
  await expect(composer(page).getByLabel("Title", { exact: true })).toHaveValue(changedHeading);
});

test("a frontmatter title survives editing the H1", async ({ page }) => {
  const title = unique("Frontmatter Title");
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  // Enabled once hydrated and authorized.
  await expect(page.locator('input[type="file"]')).toBeEnabled(ROUND_TRIP);
  await page.setInputFiles('input[type="file"]', {
    name: "fm.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(`---\ntitle: ${title}\n---\n\n# A different heading\n\ntext\n`, "utf8"),
  });
  await expect(page).not.toHaveURL(/\/new$/, ROUND_TRIP);

  const surface = await openEditor(page, page.url());
  await expect(composer(page).getByText("標題來自上傳檔案的 frontmatter")).toBeVisible();
  // The body opens with its own H1, so the editor shows that one heading, as the reader does.
  await expect(surface.getByRole("heading", { level: 1 })).toHaveCount(1);
  const source = await showMarkdown(composer(page));
  await source.fill("# Another heading entirely\n\ntext");
  await composer(page).getByRole("button", { name: "Save" }).click();
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
  await expect(page.getByRole("treeitem", { name: title, exact: true })).toBeVisible(ROUND_TRIP);
});

test("what was typed in the rendered editor survives leaving and is offered back on return", async ({ page }) => {
  const url = await createNote(page, unique("Draft"), "start\n");
  const surface = await openEditor(page, url);
  await surface.click();
  await page.keyboard.type("draft text");

  await leaveEditor(page, url);

  const back = await openEditor(page, url);
  await expect(composer(page).getByRole("status").filter({ hasText: "已還原未存的修改" })).toBeVisible();
  await expect(back).toContainText("draft text");
  await expect(back).toBeFocused(ROUND_TRIP);

  await composer(page).getByRole("button", { name: "捨棄" }).click();
  await expect(back).not.toContainText("draft text");
  await page.reload();
  await expect(back).toBeEditable(ROUND_TRIP);
  await expect(composer(page).getByRole("status").filter({ hasText: "已還原" })).toHaveCount(0);
});

test("a restored draft on a document someone changed meanwhile conflicts instead of overwriting", async ({ page }) => {
  const url = await createNote(page, unique("Stale Draft"));
  await openEditor(page, url);
  const source = await showMarkdown(composer(page));
  await source.fill("mine");
  await leaveEditor(page, url);

  // A new page is a new tab, with its own sessionStorage.
  const other = await page.context().newPage();
  await openEditor(other, url);
  const theirSource = await showMarkdown(composer(other));
  await theirSource.fill("theirs");
  await composer(other).getByRole("button", { name: "Save" }).click();
  await expect(other).not.toHaveURL(/\/edit$/, ROUND_TRIP);
  await expect(other.locator("article").first().getByText("theirs")).toBeVisible(ROUND_TRIP);
  await other.close();

  const surface = await openEditor(page, url);
  await expect(composer(page).getByRole("status").filter({ hasText: "被更新過" })).toBeVisible();
  await expect(surface).toContainText("mine");
  await composer(page).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "已被其他人更新" })).toBeVisible(ROUND_TRIP);
  await expect(surface).toContainText("mine");

  await composer(page).getByRole("button", { name: "載入最新版本（捨棄你的修改）" }).click();
  await expect(surface).toContainText("theirs", ROUND_TRIP);
  await expect(composer(page).getByRole("status").filter({ hasText: "已還原" })).toHaveCount(0);
});

test("Cancel asks before discarding changes, and discarding clears the draft", async ({ page }) => {
  const url = await createNote(page, unique("Cancel"));
  await openEditor(page, url);
  const source = await showMarkdown(composer(page));
  await source.fill("changed");
  const cancel = composer(page).getByRole("button", { name: "Cancel" });

  // waitForEvent, not page.once: a listener's own expect() cannot fail the
  // test, and toHaveURL(/\/edit$/) right after the click would pass even if
  // no dialog had appeared at all (router.push is async). Asserting the
  // Markdown field is still visible with its typed value, after the click has
  // fully resolved, is the positive signal that no navigation happened.
  //
  // The click is started but not awaited yet: window.confirm() blocks the
  // page's JS thread, and with it the click action itself, until the dialog
  // is answered — awaiting the click before consuming the dialog would
  // deadlock (measured: a real 30s test timeout on `cancel.click()`).
  const dismissed = page.waitForEvent("dialog");
  const dismissClick = cancel.click();
  const dismissDialog = await dismissed;
  expect(dismissDialog.message()).toBe("Discard changes?");
  await dismissDialog.dismiss();
  await dismissClick;
  await expect(source).toBeVisible();
  await expect(source).toHaveValue("changed");

  const accepted = page.waitForEvent("dialog");
  const acceptClick = cancel.click();
  const acceptDialog = await accepted;
  await acceptDialog.accept();
  await acceptClick;
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);

  const surface = await openEditor(page, url);
  await expect(surface).not.toContainText("changed");
  await expect(composer(page).getByRole("status").filter({ hasText: "已還原" })).toHaveCount(0);
});

test("Enter in the title field moves to the content instead of submitting", async ({ page }) => {
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  const form = composer(page);
  const titleField = form.getByLabel("Title", { exact: true });
  await expect(titleField).toBeEditable(ROUND_TRIP);
  await titleField.fill(unique("Enter In Title"));

  await titleField.press("Enter");
  await expect(page).toHaveURL(/\/new$/);
  await expect(surfaceOf(page)).toBeFocused();
});

test("a new document can be named by its H1 alone", async ({ page }) => {
  const title = unique("Only H1");
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  const form = composer(page);
  await expect(form.getByLabel("Title", { exact: true })).toBeEditable(ROUND_TRIP);
  const source = await showMarkdown(form);
  await source.fill(`# ${title}\n\nbody`);
  await expect(form.getByLabel("Title", { exact: true })).toHaveCount(0);
  await form.getByRole("button", { name: "Create document" }).click();
  await expect(page.getByRole("treeitem", { name: title, exact: true })).toBeVisible(ROUND_TRIP);
});

// Composer-side half of the create/upload exclusion (new-document-form.tsx's
// own POST is held here, not stubbed away, so the real create still runs and
// still lands): while the upload is in flight, Create must not be clickable,
// or the two could race two documents and two competing refreshOnArrival calls.
test("an upload in flight disables Create, so the two cannot race", async ({ page }) => {
  const title = unique("Held Upload");
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  const form = composer(page);
  const titleField = form.getByLabel("Title", { exact: true });
  await expect(titleField).toBeEditable(ROUND_TRIP);
  // Would otherwise make Create clickable: proves the disable below is the
  // upload's doing, not just an untitled document.
  await titleField.fill(unique("Would-be Create"));

  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/workspaces/*/documents", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    await gate;
    await route.continue();
  });

  await page.setInputFiles('input[type="file"]', {
    name: "held.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(`# ${title}\n\nbody`, "utf8"),
  });
  await expect(form.getByRole("button", { name: "Create document" })).toBeDisabled();

  release();
  await expect(page.getByRole("treeitem", { name: title, exact: true })).toBeVisible(ROUND_TRIP);
});

test("the Markdown text re-fits its height when the column rewraps", async ({ page }) => {
  const url = await createNote(page, unique("Rewrap"), "word ".repeat(400));
  await openEditor(page, url);
  const body = await showMarkdown(composer(page));
  const fits = () => body.evaluate((element: HTMLTextAreaElement) => element.scrollHeight <= element.clientHeight + 1);
  expect(await fits()).toBe(true);
  // Narrower column, more lines: without a re-fit the tail is clipped behind overflow-hidden.
  await page.setViewportSize({ width: 480, height: 800 });
  await expect.poll(fits).toBe(true);
});

test("Upload .md is a focusable button that opens the file picker", async ({ page }) => {
  const title = unique("Picked Upload");
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  const upload = page.getByRole("button", { name: "Upload .md" });
  await expect(upload).toBeEnabled(ROUND_TRIP);
  await surfaceOf(page).focus();
  await page.keyboard.press("Tab");
  await expect(upload).toBeFocused();
  await expect(upload).not.toHaveCSS("box-shadow", "none");

  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles({ name: "picked.md", mimeType: "text/markdown", buffer: Buffer.from(`# ${title}\n\nbody\n`, "utf8") });
  await expect(page.getByRole("treeitem", { name: title, exact: true })).toBeVisible(ROUND_TRIP);
});

test("a save whose client navigation never lands still ends on the document", async ({ page }) => {
  const url = await createNote(page, unique("Dropped Return"));
  await openEditor(page, url);
  const body = await showMarkdown(composer(page));
  // Hold the router's fetch of the document, so its client navigation never
  // lands — the shape of the dropped navigation measured on main. A full load
  // is a document request, not an RSC fetch, so it is not held.
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route((target) => target.pathname === url && target.searchParams.has("_rsc"), async (route) => {
    await held;
    await route.abort();
  });

  await body.fill("saved anyway");
  await composer(page).getByRole("button", { name: "Save" }).click();
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
  await expect(page.locator("article").first().getByText("saved anyway")).toBeVisible(ROUND_TRIP);

  release();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a Cancel whose client navigation never lands still leaves the editor", async ({ page }) => {
  const url = await createNote(page, unique("Dropped Cancel"));
  await openEditor(page, url);
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route((target) => target.pathname === url && target.searchParams.has("_rsc"), async (route) => {
    await held;
    await route.abort();
  });

  await composer(page).getByRole("button", { name: "Cancel" }).click();
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);

  release();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
```

- [ ] **Step 7: Run the spec, and treat the first run as the gate**

```bash
export PATH=/Users/chuntsai/.nvm/versions/node/v24.6.0/bin:$PATH
node_modules/.bin/tsc --noEmit > .superpowers/t3tsc.log 2>&1; echo "TSC=$?"
node_modules/.bin/eslint tests/e2e/document-composer.spec.ts tests/e2e/composer-helpers.ts > .superpowers/t3lint.log 2>&1; echo "LINT=$?"
rm -rf test-results
node_modules/.bin/tsx scripts/test/e2e.ts tests/e2e/document-composer.spec.ts > .superpowers/t3e2e.log 2>&1; echo "E2E_EXIT=$?"
sed 's/\x1b\[[0-9;]*m//g' .superpowers/t3e2e.log | grep -E "[0-9]+ (passed|failed)|✘" | head -20
```

Expected on a good implementation: every case passes. The most likely first failures, and what each means (fix the cause; do not loosen the assertion):

- `the rendered editor mounts without hydration or page errors` fails on a console message → read it; a hydration mismatch means something server-rendered differs from the first client render.
- A toolbar case fails at `toBeVisible` → open `test-results/*/trace.zip` (`node_modules/.bin/playwright show-trace`) and look at where the toolbar landed; it is positioned with `left`/`top` by Milkdown and needs `position: absolute` from `.kh-selection-toolbar`.
- A typing case fails because `# ` did not become a heading → check the events reach ProseMirror (`page.keyboard.type` after `surface.click()`).
- Cases that use `fill` on the textarea time out on "element is not visible" → they forgot `showMarkdown`.

If after one honest round of fixes any of these cannot be made to pass, **stop and report BLOCKED** with the failing output.

- [ ] **Step 8: Prove it is stable**

```bash
rm -rf test-results
node_modules/.bin/tsx scripts/test/e2e.ts tests/e2e/document-composer.spec.ts --repeat-each=15 > .superpowers/t3rep.log 2>&1; echo "REPEAT_EXIT=$?"
sed 's/\x1b\[[0-9;]*m//g' .superpowers/t3rep.log | grep -E "[0-9]+ (passed|failed)|✘" | head -20
```

Expected: `REPEAT_EXIT=0`, zero failures. A failure that appears only under repetition is a real defect: find its cause (the navigation drops, and the `phase5-authoring` sidebar case, are known and not in this file; anything else is new).

- [ ] **Step 9: Bundle after, and the rest of the gates**

```bash
export PATH=/Users/chuntsai/.nvm/versions/node/v24.6.0/bin:$PATH
make verify > .superpowers/t3verify.log 2>&1; echo "VERIFY_EXIT=$?"
make build > .superpowers/build-after.log 2>&1; echo "BUILD_EXIT=$?"
grep -E "knowledge/\[sourceId\]/\[documentId\]/edit|knowledge/new" .superpowers/build-before.log .superpowers/build-after.log
```

Record the before/after `First Load JS` for the edit and new pages in the report. The reading page's figure (`…/[documentId]` without `/edit`) must not have grown.

- [ ] **Step 10: Commit**

```bash
git add src/lib/form-keys.ts tests/unit/form-keys.test.ts src/components/knowledge/use-form-keys.ts src/components/knowledge/document-composer.tsx tests/e2e/composer-helpers.ts tests/e2e/document-composer.spec.ts
git commit -m "feat(ui): the composer edits the rendered document, with the Markdown a keystroke away

Claude-Session: https://claude.ai/code/session_0147bSAtofdFgcV3oVdWtipa"
```

---

### Task 4: The other specs write Markdown through the source view

Four other specs `fill` the Markdown textarea, which is now hidden until the source is shown.

**Files:**
- Modify: `tests/e2e/phase5-authoring.spec.ts`
- Modify: `tests/e2e/share-link.spec.ts`
- Modify: `tests/e2e/phase2.5-knowledge-explorer.spec.ts`

**Interfaces:**
- Consumes: Task 3's `showMarkdown(form: Locator): Promise<Locator>`.

- [ ] **Step 1: `phase5-authoring.spec.ts`**

Add `import { showMarkdown } from "./composer-helpers";` after the Playwright import. Then:

In "edits a hub-managed document and records a second revision", replace

```ts
  await editorForm.getByLabel("Markdown").fill("updated body");
```

with

```ts
  const source = await showMarkdown(editorForm);
  await source.fill("updated body");
```

In "a stale second editor gets a conflict, keeps their input, and does not overwrite the winner", replace

```ts
  await editorA.getByLabel("Markdown").fill("winner body");
```
with
```ts
  const sourceA = await showMarkdown(editorA);
  await sourceA.fill("winner body");
```

and replace the three lines

```ts
  await editorB.getByLabel("Markdown").fill("loser body");
```
```ts
  await expect(editorB.getByLabel("Markdown")).toHaveValue("loser body");
```
with
```ts
  const sourceB = await showMarkdown(editorB);
  await sourceB.fill("loser body");
```
```ts
  await expect(sourceB).toHaveValue("loser body");
```
(the first goes where the old `fill` was, before the Save click; the second where the old `toHaveValue` was).

- [ ] **Step 2: `share-link.spec.ts`**

Add `import { showMarkdown } from "./composer-helpers";`. In `createMySpaceDocument`, replace

```ts
    await form.getByLabel("Markdown").fill(body);
```
with
```ts
    const source = await showMarkdown(form);
    await source.fill(body);
```
and at the other use (the "second shared body" edit, `editorForm.getByLabel("Markdown").fill("second shared body")`) replace with
```ts
      const source = await showMarkdown(editorForm);
      await source.fill("second shared body");
```

- [ ] **Step 3: `phase2.5-knowledge-explorer.spec.ts`**

The "reading navigation separates collections…" test ends by checking the new-document page. Replace

```ts
  await expect(page.locator("main form").first().getByLabel("Markdown")).toBeVisible();
```
with
```ts
  await expect(page.locator("main form").first().getByRole("textbox", { name: "Content" })).toBeVisible();
```

- [ ] **Step 4: Verify**

```bash
export PATH=/Users/chuntsai/.nvm/versions/node/v24.6.0/bin:$PATH
node_modules/.bin/tsc --noEmit > .superpowers/t4tsc.log 2>&1; echo "TSC=$?"
node_modules/.bin/eslint tests/e2e > .superpowers/t4lint.log 2>&1; echo "LINT=$?"
rm -rf test-results
node_modules/.bin/tsx scripts/test/e2e.ts tests/e2e/phase5-authoring.spec.ts tests/e2e/share-link.spec.ts tests/e2e/phase2.5-knowledge-explorer.spec.ts tests/e2e/keyboard-shortcuts.spec.ts > .superpowers/t4e2e.log 2>&1; echo "E2E_EXIT=$?"
sed 's/\x1b\[[0-9;]*m//g' .superpowers/t4e2e.log | grep -E "[0-9]+ (passed|failed)|✘" | head
```

Expected: all pass, except possibly the known sidebar case (`phase5-authoring` › "after a save, the sidebar names the document by its new title"); if it is the only failure, run those four files once more. `keyboard-shortcuts.spec.ts` is included because it edits through the title field; it needs no change, and must still pass.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/phase5-authoring.spec.ts tests/e2e/share-link.spec.ts tests/e2e/phase2.5-knowledge-explorer.spec.ts
git commit -m "test(e2e): specs that write Markdown reach the textarea through the source view

Claude-Session: https://claude.ai/code/session_0147bSAtofdFgcV3oVdWtipa"
```

---

### Task 5: Contracts, the verification record, and the whole suite

**Files:**
- Modify: `docs/superpowers/specs/frontend-design-language.md` (§10 and §18 item 3)
- Modify: `docs/superpowers/specs/2026-09-24-keyboard-shortcuts-design.md` (the note under §5)
- Modify: `docs/superpowers/specs/2026-09-28-document-composer-design.md` (status row)
- Modify: `docs/superpowers/verification/2026-09-28-document-composer-verification.md`

- [ ] **Step 1: The design language, §10**

Replace the paragraph that begins `In the document composer (new and edit share it)` (its five lines, up to `…and it asks first.`) with:

```markdown
In the document composer (new and edit share it), ⌘Enter saves through the
form's own submit button, and only when that button is enabled. ⌘/ switches
between the rendered editor and the Markdown source; the source is the
default's opposite, a keystroke away. `Esc` leaves only a composer nothing has
been typed into, and with changes it does nothing. No key discards a draft;
Cancel is the one way to, and it asks first. ⌘K stays the global search; the
editor binds no key that is already bound.
```

Replace the sentence `The composer's title field and text are the one place without the focus ring.` with `The composer's title field, its rendered editor and its Markdown text are the one place without the focus ring.` Leave the rest of that paragraph.

In §18 item 3, replace `field), preview toggles in place, and the navigation guard this item asked` with `field), the document is edited rendered with its Markdown a toggle away, and the navigation guard this item asked` — re-flow the lines so none exceeds ~78 characters.

- [ ] **Step 2: The keyboard spec note and the composer spec status**

In `docs/superpowers/specs/2026-09-24-keyboard-shortcuts-design.md`, the note under §5 (`> 2026-09-28：…`) becomes:

```markdown
> 2026-09-28：兩個表單已合併為文件編輯器；2026-09-29 起預設為渲染編輯，並以 `⌘/Ctrl /` 切換 Markdown 原始碼（取代先前的 `⌘⇧P` 預覽）。現行規則見 `2026-09-28-document-composer-design.md` 第 11.6 節；本節保留當時的決定。
```

In `docs/superpowers/specs/2026-09-28-document-composer-design.md`, the 狀態 row becomes: `已實作。驗證見 docs/superpowers/verification/2026-09-28-document-composer-verification.md。第 11 節（2026-09-29 修訂）取代決定 1、決定 3，以及第 6 節的預覽與快捷鍵。`

- [ ] **Step 3: The verification record**

Append to `docs/superpowers/verification/2026-09-28-document-composer-verification.md` a section `## Rendered editing (spec §11)` containing, from what you actually ran and measured (nothing from memory):

- the commands and results of: `make verify` (unit count), the full `make test-e2e` (counts; note if the known sidebar case failed and how you re-ran), `document-composer.spec.ts` with `--repeat-each=15`;
- the `First Load JS` figures of the edit page and the new page **before** and **after** (from `.superpowers/build-before.log` and `build-after.log`), and the reading page's figure unchanged;
- the round-trip table: which writings stay, which are rewritten (copy the `unchanged` and `rewritten` lists from `tests/unit/markdown-editor.test.ts`), the image-title failure and its patch, and the `-` / `---` output settings;
- a list of **what was not verified**: the Firefox `Ctrl /` behaviour, Chinese (注音) input in the rendered editor including the typing conversions, and the appearance of a real imported document — state each as "not performed; needs a person" with the steps (open the editor in Firefox and press Ctrl+/ with the caret in the text; type `# ` and `- ` while an input method is composing; open a real imported document and compare before and after saving).

- [ ] **Step 4: The whole suite, and clean-up**

```bash
export PATH=/Users/chuntsai/.nvm/versions/node/v24.6.0/bin:$PATH
make verify > .superpowers/t5verify.log 2>&1; echo "VERIFY_EXIT=$?"
make test-e2e > .superpowers/t5e2e.log 2>&1; echo "E2E_EXIT=$?"
sed 's/\x1b\[[0-9;]*m//g' .superpowers/t5e2e.log | grep -E "[0-9]+ (passed|failed)|✘" | head
rm -rf .superpowers/mk-probe
git status --short | grep -v '^??'
```

Expected: `VERIFY_EXIT=0` and `E2E_EXIT=0`, or the known sidebar case as the only failure, re-run once with both runs recorded. `git status` shows only the docs you edited.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/frontend-design-language.md docs/superpowers/specs/2026-09-24-keyboard-shortcuts-design.md docs/superpowers/specs/2026-09-28-document-composer-design.md docs/superpowers/verification/2026-09-28-document-composer-verification.md
git commit -m "docs: rendered editing in the design language, the keyboard spec and the verification record

Claude-Session: https://claude.ai/code/session_0147bSAtofdFgcV3oVdWtipa"
```
