# Toggle Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners turn a paragraph into a collapsible toggle from the editor toolbar, fold/unfold it by click or Alt+Enter, and the open state persists through save and reload.

**Architecture:** Reuse the existing `<details>/<summary>` pipeline end to end (subset parser, native reader disclosure, verbatim editor round-trip, review anchors inside the body). New code is one editor module (`details-toggle.ts`: pure helpers, toolbar conversion, open-flip) plus three small wirings (toolbar button, `Alt+Enter` key branch, outline ancestor-open).

**Tech Stack:** TypeScript, Milkdown 7.22.2 + ProseMirror (via `@milkdown/kit/*`), Vitest (unit + rendered-editor tests), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-10-14-toggle-details-design.md`

## Global Constraints

- `src/modules/**` may not import `next`, `react`, `mariadb`, or anything under `src/infrastructure/`.
- `src/components/**` and `src/app/**` may not import `src/infrastructure/` or `mariadb`.
- No new Markdown syntax and no parser change: stored shape is exactly `<details>`, `<summary>…</summary>`, blank line, body blocks, blank line, `</details>`, with optional ` open` on the opening tag.
- `Cmd/Ctrl+Enter` keeps meaning Save everywhere, including with the caret inside a toggle.
- Single level only: nested `<details>` keeps today's verbatim treatment, no creation UI, no interaction guarantee.
- Work happens on branch `feat/toggle-details` (from `main`), in a separate worktree from the PR #190 checkout; never push or merge without explicit user consent.

- Work happens on branch `feat/share-comment-notify` is forbidden for this feature: use `feat/toggle-details` (from `main`) in a separate worktree so the PR #190 checkout (served by the local dev server) is untouched. Executor setup, once, before Task 1:

```bash
git worktree add ../km-wt-toggle -b feat/toggle-details main
ln -s /Users/chuntsai/Projects/km-wt-2/node_modules ../km-wt-toggle/node_modules
cp /Users/chuntsai/Projects/km-wt-2/.env ../km-wt-toggle/.env
```

All paths below are relative to the worktree root. No schema change in this feature, so the shared MariaDB instance is safe (migrations untouched).

---

## File Structure

- Create: `src/components/knowledge/editor/details-toggle.ts` — pure helpers (`flipOpenTag`, `escapeSummaryText`), ProseMirror helpers (`nearestDetailsOpener`, `flipNearestDetails`, `convertBlockToDetails`, `inDetails`).
- Modify: `src/components/knowledge/editor/selection-toolbar.ts` — one `Item` ("Toggle section"), same shape as the list buttons.
- Modify: `src/components/knowledge/editor/editor-core.ts` — one `Alt+Enter` branch in `handleKeyDown` (same guard pattern as the Shift+Enter branch) + import.
- Modify: `src/components/knowledge/document-outline.tsx` — `goToHeading` opens ancestor disclosures first via exported `openAncestorDetails` in `use-active-heading.ts`.
- Modify: `src/components/knowledge/use-active-heading.ts` — add exported `openAncestorDetails`.
- Test: `tests/unit/details-toggle.test.ts` (pure helpers), `tests/unit/editor-toggle-details.test.ts` (rendered editor, jsdom, `createMarkdownEditor` pattern from `editor-wikilinks.test.ts`), `tests/unit/outline-details.test.ts` (jsdom), `tests/e2e/toggle-details.spec.ts`.

---

### Task 1: Pure helpers and unit tests

**Files:**
- Create: `src/components/knowledge/editor/details-toggle.ts` (helpers only in this task; ProseMirror parts arrive in Tasks 2–3)
- Test: `tests/unit/details-toggle.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `flipOpenTag(value: string): string | null`, `escapeSummaryText(text: string): string` — exact names later tasks import.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { escapeSummaryText, flipOpenTag } from "@/components/knowledge/editor/details-toggle";
describe("flipOpenTag", () => {
  it("adds and removes the open attribute", () => {
    expect(flipOpenTag("<details>")).toBe("<details open>");
    expect(flipOpenTag("<details open>")).toBe("<details>");
  });
  it("ignores surrounding whitespace and rejects anything else", () => {
    expect(flipOpenTag("  <details>  ")).toBe("<details open>");
    expect(flipOpenTag("</details>")).toBeNull();
    expect(flipOpenTag('<details class="x">')).toBeNull();
    expect(flipOpenTag("<summary>x</summary>")).toBeNull();
  });
});
describe("escapeSummaryText", () => {
  it("escapes what would break the summary line", () => {
    expect(escapeSummaryText("a<b>&c>d")).toBe("a&lt;b&gt;&amp;c&gt;d");
    expect(escapeSummaryText("plain")).toBe("plain");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/details-toggle.test.ts`
Expected: FAIL with "Failed to resolve import ... details-toggle"

- [ ] **Step 3: Write minimal implementation** (append ProseMirror code only in Tasks 2–3; this task ends after the two functions)

```ts
/** Flips a details opening tag, or null when the value is not exactly one. */
export function flipOpenTag(value: string): string | null {
  const text = value.trim();
  if (/^<details>$/.test(text)) return "<details open>";
  if (/^<details\s+open>$/.test(text)) return "<details>";
  return null;
}
/** Summary text must not contain angle brackets: the subset parser reads them as tags. */
export function escapeSummaryText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.ts tests/unit/details-toggle.test.ts`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/components/knowledge/editor/details-toggle.ts tests/unit/details-toggle.test.ts
git commit -m "feat(toggle): open-attribute flip and summary escaping helpers"
```

---

### Task 2: Toolbar Toggle button and block conversion

**Files:**
- Modify: `src/components/knowledge/editor/details-toggle.ts` (append ProseMirror helpers)
- Modify: `src/components/knowledge/editor/selection-toolbar.ts` (one `Item`)
- Test: `tests/unit/editor-toggle-details.test.ts` (new file, `// @vitest-environment jsdom`, `open()` helper verbatim from `tests/unit/editor-wikilinks.test.ts:20-44`)

**Interfaces:**
- Consumes: `flipOpenTag`, `escapeSummaryText` (Task 1); `schema.nodes.html` (`value` attr, as observed in `reader-hints.ts`), `schema.nodes.paragraph` (Milkdown commonmark preset).
- Produces: `nearestDetailsOpener`, `flipNearestDetails`, `convertBlockToDetails`, `inDetails` — exact names Task 3 imports.

The opener scan (single-level semantics; nested resolves innermost, which the spec leaves unsupported but harmless):

```ts
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorState } from "@milkdown/kit/prose/state";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
const DETAILS_OPEN = /^<details(\s+open)?>$/i;
const DETAILS_CLOSE = /^<\/details>$/i;
/** Innermost details opener at or before pos whose body contains pos. */
export function nearestDetailsOpener(state: EditorState, pos: number): { position: number; open: boolean } | null {
  const stack: { position: number; open: boolean }[] = [];
  state.doc.descendants((node: ProseNode, position: number) => {
    if (position > pos) return false;
    if (node.type.name !== "html") return;
    const text = String(node.attrs.value ?? "").trim();
    if (DETAILS_CLOSE.test(text)) {
      stack.pop();
      return;
    }
    const match = DETAILS_OPEN.exec(text);
    if (match) stack.push({ position, open: match[1] !== undefined });
  });
  return stack.length > 0 ? stack[stack.length - 1] : null;
}
export function inDetails(view: EditorView): boolean {
  return nearestDetailsOpener(view.state, view.state.selection.$from.pos) !== null;
}
```

The conversion (one undo step; caret lands in the new empty body):

```ts
export function convertBlockToDetails(view: EditorView): boolean {
  const { state } = view;
  if (!(state.selection instanceof TextSelection)) return false;
  const { $from } = state;
  const parent = $from.parent;
  if (parent.type.name !== "paragraph" && parent.type.name !== "heading") return false;
  const html = state.schema.nodes.html;
  const paragraph = state.schema.nodes.paragraph;
  if (!html || !paragraph) return false;
  const start = $from.start();
  const end = $from.end();
  const summary = escapeSummaryText(parent.textContent);
  let tr = state.tr.replaceWith(start, end, [
    html.create({ value: "<details>" }),
    html.create({ value: `<summary>${summary}</summary>` }),
    paragraph.create(),
    html.create({ value: "</details>" }),
  ]);
  let caret: number | null = null;
  tr.doc.descendants((node: ProseNode, position: number) => {
    if (caret !== null) return false;
    if (position < start) return;
    if (node.type.name === "paragraph" && node.content.size === 0) caret = position + 1;
  });
  if (caret !== null) tr = tr.setSelection(new TextSelection(tr.doc.resolve(caret)));
  view.dispatch(tr.scrollIntoView());
  return true;
}
```

Toolbar item (append to `items` in `selection-toolbar.ts`, after the numbered-list entry):

```ts
{
  label: "Toggle section",
  text: "Toggle",
  active: (view) => inDetails(view),
  disabled: (view) => {
    const parent = view.state.selection.$from.parent;
    return parent.type.name !== "paragraph" && parent.type.name !== "heading";
  },
  run: (ctx, view) => {
    convertBlockToDetails(view);
  },
},
```

And add the import: `import { convertBlockToDetails, inDetails } from "./details-toggle";`

- [ ] **Step 1: Write the failing rendered-editor tests** (`tests/unit/editor-toggle-details.test.ts`, jsdom, same `open`/`view` helpers and `afterEach` teardown as `editor-wikilinks.test.ts`):

```ts
it("turns the current paragraph into a toggle and keeps it through save and reopen", async () => {
  const editor = await open("Fold me");
  const v = view(editor);
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 1)));
  expect(convertBlockToDetails(v)).toBe(true);
  const saved = editor.getMarkdown();
  expect(saved).toContain("<details>");
  expect(saved).toContain("<summary>Fold me</summary>");
  expect(saved).toContain("</details>");
  const reopened = await open(saved);
  expect(reopened.getMarkdown()).toBe(saved);
});
it("refuses outside paragraphs and headings", async () => {
  const editor = await open("```js\nconst a = 1;\n```");
  const v = view(editor);
  expect(convertBlockToDetails(v)).toBe(false);
});
```

`TextSelection` import in the test: `import { TextSelection } from "@milkdown/kit/prose/state";`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/editor-toggle-details.test.ts`
Expected: FAIL with a missing-export error (`convertBlockToDetails` does not exist yet).

- [ ] **Step 3: Write the implementation** (helpers + toolbar item + import, code above verbatim)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/editor-toggle-details.test.ts tests/unit/details-toggle.test.ts`
Expected: PASS. If the round-trip assertion fails on serializer whitespace, first re-read the failure: the required shape is the existing passing fixture `<details>\n<summary>More</summary>\n\nbody\n\n</details>\n` from `editor-reader-hints.test.ts:128`. Adjust only the node order in `convertBlockToDetails` (never the parser), until open→save→reopen is byte-stable.

- [ ] **Step 5: Commit**

```bash
git add src/components/knowledge/editor/details-toggle.ts src/components/knowledge/editor/selection-toolbar.ts tests/unit/editor-toggle-details.test.ts
git commit -m "feat(toggle): toolbar conversion of a block into a details disclosure"
```

---

### Task 3: Alt+Enter open-state flipping

**Files:**
- Modify: `src/components/knowledge/editor/details-toggle.ts` (append flip helper)
- Modify: `src/components/knowledge/editor/editor-core.ts` (Alt+Enter branch + import)
- Test: extend `tests/unit/editor-toggle-details.test.ts`

**Interfaces:**
- Consumes: `nearestDetailsOpener`, `flipOpenTag` (Tasks 1–2).
- Produces: `flipNearestDetails` — exact name editor-core imports.

Ruling (supersedes the click-plugin draft below in history): DOM inspection
proved Milkdown renders html nodes as escaped tag text, so a disclosure has
no clickable element in the editor — no click handler is implemented.
Folding affordance in the editor is `Alt+Enter` only; visual folding stays
a reader capability.

```ts
/** Rewrites the nearest opener at pos, or false when the caret is not in a toggle. */
export function flipNearestDetails(view: EditorView, pos: number): boolean {
  const found = nearestDetailsOpener(view.state, pos);
  if (!found) return false;
  const html = view.state.schema.nodes.html;
  const node = view.state.doc.nodeAt(found.position);
  if (!node || node.type.name !== "html" || !html) return false;
  const flipped = flipOpenTag(String(node.attrs.value ?? ""));
  if (!flipped) return false;
  view.dispatch(view.state.tr.replaceWith(found.position, found.position + node.nodeSize, html.create({ value: flipped })));
  return true;
}
In `editor-core.ts`, inside `handleKeyDown` before `return Boolean(previous.handleKeyDown?.(view, event));`:

```ts
if (event.key === "Enter" && event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.isComposing && event.keyCode !== 229 && flipNearestDetails(view, view.state.selection.$from.pos)) return true;
```

Wire the import in `editor-core.ts`: `import { flipNearestDetails } from "./details-toggle";`

- [ ] **Step 1: Extend the rendered-editor tests**

```ts
it("flips the open attribute at the caret and keeps it through reopen", async () => {
  const editor = await open("<details>\n<summary>More</summary>\n\nbody\n\n</details>\n");
  const v = view(editor);
  expect(flipNearestDetails(v, 1)).toBe(true);
  const saved = editor.getMarkdown();
  expect(saved).toContain("<details open>");
  const reopened = await open(saved);
  expect(reopened.getMarkdown()).toBe(saved);
});
it("flips back and ignores positions outside any toggle", async () => {
  const editor = await open("<details open>\n<summary>More</summary>\n\nbody\n\n</details>\n\ntail");
  const v = view(editor);
  const tail = editor.getMarkdown().length;
  expect(flipNearestDetails(v, tail)).toBe(false);
  expect(flipNearestDetails(v, 1)).toBe(true);
  expect(editor.getMarkdown()).not.toContain("<details open>");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/editor-toggle-details.test.ts`
Expected: FAIL with "flipNearestDetails is not defined" (import) or equivalent missing-export error.

- [ ] **Step 3: Write the implementation** (code above verbatim)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/editor-toggle-details.test.ts tests/unit/details-toggle.test.ts tests/unit/editor-reader-hints.test.ts tests/unit/markdown-editor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/knowledge/editor/details-toggle.ts src/components/knowledge/editor/editor-core.ts tests/unit/editor-toggle-details.test.ts
git commit -m "feat(toggle): click and Alt+Enter open-state flipping in the editor"
```

---

### Task 4: Outline jump opens ancestor disclosures

**Files:**
- Modify: `src/components/knowledge/use-active-heading.ts` (append exported helper)
- Modify: `src/components/knowledge/document-outline.tsx` (call it in `goToHeading`)
- Test: `tests/unit/outline-details.test.ts` (new file, `// @vitest-environment jsdom`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `openAncestorDetails(target: HTMLElement): void`.

```ts
/** Opens closed ancestor disclosures so a jumped-to heading is actually visible. */
export function openAncestorDetails(target: HTMLElement): void {
  let ancestor = target.parentElement;
  while (ancestor) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
    ancestor = ancestor.parentElement;
  }
}
```

In `goToHeading` (`document-outline.tsx`), after `if (!target) return;`:

```ts
openAncestorDetails(target);
```

And add the import: `import { findHeading, openAncestorDetails } from "./use-active-heading";` (replacing the existing `findHeading`-only import).

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { openAncestorDetails } from "@/components/knowledge/use-active-heading";
function heading(): HTMLElement {
  document.body.innerHTML = `<article><details id="a"><summary>T</summary><div><details id="b"><summary>U</summary><div><h2 id="h">Hi</h2></div></details></div></details></article>`;
  const h = document.getElementById("h");
  expect(h).not.toBeNull();
  return h as HTMLElement;
}
describe("openAncestorDetails", () => {
  it("opens closed ancestor disclosures", () => {
    openAncestorDetails(heading());
    expect((document.getElementById("a") as HTMLDetailsElement).open).toBe(true);
    expect((document.getElementById("b") as HTMLDetailsElement).open).toBe(true);
  });
  it("tolerates headings with no details ancestors", () => {
    document.body.innerHTML = `<article><h2 id="h">Hi</h2></article>`;
    const h = document.getElementById("h");
    expect(h).not.toBeNull();
    expect(() => openAncestorDetails(h as HTMLElement)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/outline-details.test.ts`
Expected: FAIL with "openAncestorDetails ... does not exist" (import error).

- [ ] **Step 3: Write the implementation** (helper + `goToHeading` call + import, code above verbatim)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/outline-details.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/knowledge/use-active-heading.ts src/components/knowledge/document-outline.tsx tests/unit/outline-details.test.ts
git commit -m "feat(toggle): outline jumps open ancestor disclosures first"
```

---

### Task 5: E2E through the real composer and reader

**Files:**
- Create: `tests/e2e/toggle-details.spec.ts`
- Test: same file.

**Interfaces:**
- Consumes: `createReviewDocument` fixture is review-specific; instead create via `POST <origin>/api/workspaces/<ws>/documents` exactly as `tests/e2e/fixtures/document-review.ts:4-10` does (PERSONAL workspace lookup, `{ title, markdown }`), reusing `phase3Origin("reviewOwner")`.

E2E (follow `shared-review.spec.ts` interaction idioms: `page.getByRole`, exact text, `expect.poll`):

```ts
import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
test("a paragraph becomes a toggle, folds, and persists open state", async ({ page, request }) => {
  const origin = phase3Origin("reviewOwner");
  const navigation = await (await request.get(`${origin}/api/workspaces`)).json();
  const workspaceId = navigation.items.find((item: { type: string }) => item.type === "PERSONAL").id;
  const created = await (await request.post(`${origin}/api/workspaces/${workspaceId}/documents`, { data: { title: `Toggle ${Date.now()}`, markdown: "Fold me" } })).json();
  const editHref = `${origin}/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}/edit`;
  await page.goto(editHref);
  await page.getByLabel("Content").click();
  await page.keyboard.press("Meta+a");
  await page.getByRole("button", { name: "Toggle section" }).click();
  await expect(page.locator("summary").getByText("Fold me")).toBeVisible();
  await page.locator("summary").getByText("Fold me").click();
  await expect(page.locator("details[open]")).toHaveCount(0);
  await page.locator("summary").getByText("Fold me").click();
  await expect(page.locator("details[open]")).toHaveCount(1);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForURL(/\/knowledge\//);
  await expect(page.locator("details summary").getByText("Fold me")).toBeVisible();
});
```

Notes the implementer must honor: if the composer Save button's accessible name differs, read `src/app/w/[workspaceId]/knowledge/new/page.tsx` and the edit page for the exact label and adjust only the name (not the flow). If the selection toolbar does not appear for select-all, select the paragraph text via keyboard (`Shift+Home`) instead. If `details[open]` count assertions race the Markdown debounce (~200 ms), wrap them in `expect.poll`.

- [ ] **Step 1: Write the spec.**
- [ ] **Step 2: Run it** — `make browsers` (once), then `npm run test:e2e -- toggle-details.spec.ts`. Expected: PASS. On failure, read the trace (`test-results/toggle-details-*/trace.zip` via the printed `show-trace` hint) before changing code.
- [ ] **Step 3: Commit**

```bash
git add tests/e2e/toggle-details.spec.ts
git commit -m "test(toggle): e2e creation, folding, and persistence"
```

---

### Task 6: Full gate and PR

- [ ] **Step 1: Run the full gate**

Run: `make verify`
Expected: exit 0 (unit + typecheck + lint + build).

- [ ] **Step 2: Run integration**

Run: `make test-integration`
Expected: PASS (no schema change in this feature, so this is regression-only).

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/toggle-details
gh pr create --base main --head feat/toggle-details --title "feat(editor): collapsible toggle sections on the details pipeline" --body "What is in the spec and the test evidence (commands + results). Never merge or push without explicit user consent beyond this plan."
```

Do NOT merge. Report the PR URL and stop.
