# Document Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two form pages (edit, new) with one composer laid out like the reader — title that follows the content, a preview toggle, and unsaved drafts kept in the tab.

**Architecture:** Routes, server gates and the authoring API are unchanged. Three pure modules in `src/lib/` carry every rule that can be unit-tested (title resolution, draft storage, form-key intent); one client component, `DocumentComposer`, renders the reader's header row and column and wires those rules to the page; `DocumentEditor` and `NewDocumentForm` become thin wrappers that say where to send the document.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind (replaced scales), Base UI, `mdast-util-from-markdown` + `mdast-util-to-string` (already dependencies), Vitest (node environment, no jsdom), Playwright (Chromium only).

**Spec:** `docs/superpowers/specs/2026-09-28-document-composer-design.md`

Chinese text in the code examples and quoted UI copy below is preserved as literal test input or interface examples.

## Global Constraints

- Tailwind `fontSize`, `borderRadius`, `boxShadow`, `transitionDuration`, `transitionTimingFunction`, `maxWidth`, `padding`, `margin`, `gap`, `space` scales are **replaced**: only contract token names compile (`text-body`, `text-reading`, `text-heading`, `text-caption`, `rounded-md`, `px-3`, `gap-2`, `pt-4`, `py-6`, …). `text-sm`, `rounded`, `px-7`, `max-w-4xl` produce no CSS.
- No colour outside `src/app/globals.css` tokens; use `kh-*` classes (`text-kh-text`, `text-kh-text-muted`, `bg-kh-bg-subtle`, `bg-kh-bg-selected`, `border-kh-border`).
- Controls keep `kh-focus-ring` (buttons already have it). The title input and the Markdown textarea carry **no** focus ring (spec §6); nothing else is exempt.
- Toggle visibility with the `hidden` attribute, and never put a `display` utility (`block`, `flex`, `grid`, `inline-block`) on the same element: utilities load after Tailwind's `[hidden]` base rule and would override it.
- No hard delete, no new revision without an explicit Save: nothing in this plan may call the authoring API except the Save/Create submit and the existing upload.
- API contract unchanged: `PATCH /api/documents/:id` takes `{ title, markdown, expectedCurrentRevisionId }`; `POST /api/workspaces/:id/documents` takes `{ title, markdown }` or `{ filename, markdown }`.
- UI copy is verbatim from the spec: `標題來自上傳檔案的 frontmatter`, `已還原未存的修改。`, `這份文件在你離開後被更新過，已還原你未存的修改。`, `捨棄`, `這份文件已被其他人更新。你的輸入仍保留在表單中。`, `載入最新版本（捨棄你的修改）`, `Discard changes?`.
- Field accessible names: `Title` (only when shown) and `Markdown`, on both pages.
- No new npm dependencies.
- **This machine's shell:** bare `npm`, `npx` and `node` are shadowed by an nvm function and fail with `command not found: _nvm_load`. Always `export PATH=/Users/chuntsai/.nvm/versions/node/v24.6.0/bin:$PATH` and call `node_modules/.bin/<tool>` directly. Never pipe a test command into `tail`/`head` without printing its exit code: `cmd > log 2>&1; echo "EXIT=$?"`.
- Commit messages end with the line `Claude-Session: https://claude.ai/code/session_0147bSAtofdFgcV3oVdWtipa`.

## File Structure

```text
Create  src/lib/authored-title.ts                       resolveAuthoredTitle(), carryTitle() — pure
Create  src/lib/document-draft.ts                       draft key, read/sync/clear, browserDraftStorage() — pure except the last
Create  src/lib/form-keys.ts                            formKeyIntent() — pure
Create  src/server/document-location.ts                 documentLocation() — breadcrumb up to a document
Create  src/components/knowledge/document-breadcrumb.tsx <DocumentBreadcrumb>, DocumentBreadcrumbSegment
Create  src/components/knowledge/document-composer.tsx   <DocumentComposer>
Create  tests/unit/authored-title.test.ts
Create  tests/unit/document-draft.test.ts
Create  tests/unit/form-keys.test.ts
Create  tests/unit/document-location.test.ts
Create  tests/e2e/document-composer.spec.ts
Modify  src/components/knowledge/use-form-keys.ts        dispatch on formKeyIntent; optional preview
Modify  src/components/knowledge/document-header.tsx     render <DocumentBreadcrumb>
Modify  src/components/knowledge/document-inspector.tsx  import the segment type from document-breadcrumb
Modify  src/components/knowledge/document-viewer.tsx     export <MarkdownArticle>
Modify  src/components/knowledge/document-editor.tsx     thin wrapper over the composer
Modify  src/components/knowledge/new-document-form.tsx   thin wrapper; upload kept; sidebar variant removed
Modify  src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/page.tsx       use documentLocation()
Modify  src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/edit/page.tsx  pass location + metadataTitle
Modify  src/app/w/[workspaceId]/knowledge/new/page.tsx   composer replaces PageHeader + nested <main>
Modify  tests/e2e/phase5-authoring.spec.ts               new field names; conflict button
Modify  tests/e2e/keyboard-shortcuts.spec.ts             new field name
Modify  tests/e2e/share-link.spec.ts                     new field names
Modify  docs (Task 7)
```

Spec §3 lists a `useDraft` hook. Three calls to `readDraft`/`syncDraft`/`clearDraft` with `browserDraftStorage()` need no hook, so it is folded into `document-draft.ts`; Task 7 amends the spec's table.

---

### Task 1: Title resolution

**Files:**
- Create: `src/lib/authored-title.ts`
- Test: `tests/unit/authored-title.test.ts`

**Interfaces:**
- Consumes: `markdownOpensWithHeading(markdown: string): boolean` from `src/lib/markdown-title.ts` (existing).
- Produces:
  - `type AuthoredTitleSource = "METADATA" | "H1" | "TYPED"`
  - `type AuthoredTitle = { title: string; source: AuthoredTitleSource }`
  - `resolveAuthoredTitle(input: { metadataTitle: unknown; markdown: string; typedTitle: string }): AuthoredTitle`
  - `carryTitle(before: AuthoredTitle, after: AuthoredTitle, typedTitle: string): string`

- [ ] **Step 1: Write the failing test**

`tests/unit/authored-title.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { carryTitle, resolveAuthoredTitle, type AuthoredTitle } from "@/lib/authored-title";

function resolve(markdown: string, typedTitle = "", metadataTitle: unknown = undefined) {
  return resolveAuthoredTitle({ metadataTitle, markdown, typedTitle });
}

describe("resolveAuthoredTitle", () => {
  it("takes a frontmatter title carried in metadata over everything else", () => {
    expect(resolve("# Heading\n\nbody", "Typed", " From Frontmatter ")).toEqual({ title: "From Frontmatter", source: "METADATA" });
  });

  it("falls through a blank or non-string metadata title", () => {
    expect(resolve("# Heading", "", "   ")).toEqual({ title: "Heading", source: "H1" });
    expect(resolve("# Heading", "", 42)).toEqual({ title: "Heading", source: "H1" });
  });

  it("takes the H1 the document opens with, ignoring the typed title", () => {
    expect(resolve("# Onboarding checklist\n\n- Day 1", "Old name")).toEqual({ title: "Onboarding checklist", source: "H1" });
  });

  it("reads an H1 with inline formatting as plain text, as import does", () => {
    expect(resolve("# **季度** `OKR` 目標")).toEqual({ title: "季度 OKR 目標", source: "H1" });
  });

  it("allows a BOM and blank lines before the opening H1", () => {
    expect(resolve("﻿\n\n# After blanks")).toEqual({ title: "After blanks", source: "H1" });
  });

  it("uses the typed title, trimmed, when the H1 is not the first thing", () => {
    expect(resolve("Intro\n\n# Later heading", " Typed ")).toEqual({ title: "Typed", source: "TYPED" });
  });

  it("does not count an H2 or a setext heading as the opening H1", () => {
    expect(resolve("## Section", "Typed").source).toBe("TYPED");
    expect(resolve("Setext\n===", "Typed").source).toBe("TYPED");
  });

  it("uses the typed title when the opening H1 yields no text", () => {
    expect(resolve("# ![](diagram.png)", "Typed")).toEqual({ title: "Typed", source: "TYPED" });
  });

  it("returns an empty title when nothing supplies one", () => {
    expect(resolve("", "   ")).toEqual({ title: "", source: "TYPED" });
  });
});

describe("carryTitle", () => {
  const h1: AuthoredTitle = { title: "Heading", source: "H1" };
  const typed: AuthoredTitle = { title: "", source: "TYPED" };

  it("fills the title field with the H1 that was just removed", () => {
    expect(carryTitle(h1, typed, "stale saved title")).toBe("Heading");
  });

  it("leaves the typed title alone on every other transition", () => {
    expect(carryTitle(typed, typed, "mine")).toBe("mine");
    expect(carryTitle(typed, h1, "mine")).toBe("mine");
    expect(carryTitle(h1, h1, "mine")).toBe("mine");
    const metadata: AuthoredTitle = { title: "M", source: "METADATA" };
    expect(carryTitle(metadata, metadata, "mine")).toBe("mine");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH=/Users/chuntsai/.nvm/versions/node/v24.6.0/bin:$PATH; node_modules/.bin/vitest run --config vitest.config.ts tests/unit/authored-title.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t1.log`
Expected: `EXIT=1`, failure resolving `@/lib/authored-title`.

- [ ] **Step 3: Write the implementation**

`src/lib/authored-title.ts`:

```ts
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import { markdownOpensWithHeading } from "@/lib/markdown-title";

export type AuthoredTitleSource = "METADATA" | "H1" | "TYPED";
export type AuthoredTitle = { title: string; source: AuthoredTitleSource };

/**
 * The title a document written in the Hub is saved under (composer spec §4).
 * Metadata first, so a revision never disagrees with the frontmatter title it
 * carries; then the H1 the document opens with, because that is the title the
 * reader shows; then whatever was typed into the title field.
 */
export function resolveAuthoredTitle(input: { metadataTitle: unknown; markdown: string; typedTitle: string }): AuthoredTitle {
  const metadataTitle = typeof input.metadataTitle === "string" ? input.metadataTitle.trim() : "";
  if (metadataTitle) return { title: metadataTitle, source: "METADATA" };
  const heading = openingHeadingText(input.markdown);
  if (heading) return { title: heading, source: "H1" };
  return { title: input.typedTitle.trim(), source: "TYPED" };
}

/**
 * "Opens with" is the reader's test (`markdownOpensWithHeading`), so the editor
 * names the document by the heading the reader shows as its title. The text is
 * read the way folder import reads an H1, so one file yields one title.
 */
function openingHeadingText(markdown: string): string {
  if (!markdownOpensWithHeading(markdown)) return "";
  const first = fromMarkdown(markdown).children[0];
  if (first?.type !== "heading" || first.depth !== 1) return "";
  return toString(first).trim();
}

/** Deleting the opening H1 reveals the title field; it starts with the title the H1 was giving. */
export function carryTitle(before: AuthoredTitle, after: AuthoredTitle, typedTitle: string): string {
  return before.source === "H1" && after.source === "TYPED" ? before.title : typedTitle;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: the Step 2 command.
Expected: `EXIT=0`, 11 tests passed. If only the BOM case fails, `fromMarkdown` kept the BOM as text: strip it first with `markdown.replace(/^﻿/u, "")` before calling `fromMarkdown`, and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/lib/authored-title.ts tests/unit/authored-title.test.ts
git commit -m "feat(lib): a document is named by its metadata title, its opening H1, or what was typed

Claude-Session: https://claude.ai/code/session_0147bSAtofdFgcV3oVdWtipa"
```

---

### Task 2: Draft storage

**Files:**
- Create: `src/lib/document-draft.ts`
- Test: `tests/unit/document-draft.test.ts`

**Interfaces:**
- Produces:
  - `type DraftKey = { kind: "edit"; documentId: string } | { kind: "new"; workspaceId: string }`
  - `type Draft = { title: string; markdown: string; baseRevisionId: string | null }`
  - `type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">`
  - `draftStorageKey(key: DraftKey): string`
  - `readDraft(storage: DraftStorage | null, key: DraftKey): Draft | null`
  - `syncDraft(storage: DraftStorage | null, key: DraftKey, draft: Draft, initial: { title: string; markdown: string }): void`
  - `clearDraft(storage: DraftStorage | null, key: DraftKey): void`
  - `browserDraftStorage(): DraftStorage | null`

- [ ] **Step 1: Write the failing test**

`tests/unit/document-draft.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clearDraft, draftStorageKey, readDraft, syncDraft, type DraftKey, type DraftStorage } from "@/lib/document-draft";

function memoryStorage(): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

const refusing: DraftStorage = {
  getItem: () => { throw new Error("SecurityError"); },
  setItem: () => { throw new Error("QuotaExceededError"); },
  removeItem: () => { throw new Error("SecurityError"); },
};

const edit: DraftKey = { kind: "edit", documentId: "doc-1" };
const create: DraftKey = { kind: "new", workspaceId: "ws-1" };
const initial = { title: "Saved", markdown: "saved body" };

describe("draftStorageKey", () => {
  it("names edit and new drafts apart", () => {
    expect(draftStorageKey(edit)).toBe("kh:draft:edit:doc-1");
    expect(draftStorageKey(create)).toBe("kh:draft:new:ws-1");
  });
});

describe("syncDraft and readDraft", () => {
  it("keeps a draft that differs from what the composer opened with", () => {
    const storage = memoryStorage();
    syncDraft(storage, edit, { title: "Saved", markdown: "changed", baseRevisionId: "rev-1" }, initial);
    expect(readDraft(storage, edit)).toEqual({ title: "Saved", markdown: "changed", baseRevisionId: "rev-1" });
  });

  it("removes the draft once it matches what the composer opened with again", () => {
    const storage = memoryStorage();
    syncDraft(storage, edit, { title: "Saved", markdown: "changed", baseRevisionId: "rev-1" }, initial);
    syncDraft(storage, edit, { title: "Saved", markdown: "saved body", baseRevisionId: "rev-1" }, initial);
    expect(storage.map.size).toBe(0);
    expect(readDraft(storage, edit)).toBeNull();
  });

  it("keeps edit and new drafts from overwriting each other", () => {
    const storage = memoryStorage();
    syncDraft(storage, edit, { title: "A", markdown: "a", baseRevisionId: "rev-1" }, initial);
    syncDraft(storage, create, { title: "B", markdown: "b", baseRevisionId: null }, { title: "", markdown: "" });
    expect(readDraft(storage, edit)?.title).toBe("A");
    expect(readDraft(storage, create)).toEqual({ title: "B", markdown: "b", baseRevisionId: null });
  });

  it("reads nothing from a missing, corrupt, foreign-version or wrong-shaped entry", () => {
    const storage = memoryStorage();
    expect(readDraft(storage, edit)).toBeNull();
    storage.map.set("kh:draft:edit:doc-1", "{not json");
    expect(readDraft(storage, edit)).toBeNull();
    storage.map.set("kh:draft:edit:doc-1", JSON.stringify({ v: 2, title: "t", markdown: "m", baseRevisionId: null }));
    expect(readDraft(storage, edit)).toBeNull();
    storage.map.set("kh:draft:edit:doc-1", JSON.stringify({ v: 1, title: 7, markdown: "m", baseRevisionId: null }));
    expect(readDraft(storage, edit)).toBeNull();
    storage.map.set("kh:draft:edit:doc-1", "null");
    expect(readDraft(storage, edit)).toBeNull();
  });
});

describe("a storage that refuses", () => {
  it("never throws and reads as no draft", () => {
    const draft = { title: "t", markdown: "m", baseRevisionId: null };
    expect(() => syncDraft(refusing, edit, draft, initial)).not.toThrow();
    expect(() => syncDraft(refusing, edit, { ...draft, ...initial }, initial)).not.toThrow();
    expect(() => clearDraft(refusing, edit)).not.toThrow();
    expect(readDraft(refusing, edit)).toBeNull();
  });

  it("treats no storage at all the same way", () => {
    expect(() => syncDraft(null, edit, { title: "t", markdown: "m", baseRevisionId: null }, initial)).not.toThrow();
    expect(readDraft(null, edit)).toBeNull();
  });
});

describe("clearDraft", () => {
  it("removes only the named draft", () => {
    const storage = memoryStorage();
    syncDraft(storage, edit, { title: "A", markdown: "a", baseRevisionId: "rev-1" }, initial);
    syncDraft(storage, create, { title: "B", markdown: "b", baseRevisionId: null }, { title: "", markdown: "" });
    clearDraft(storage, edit);
    expect(readDraft(storage, edit)).toBeNull();
    expect(readDraft(storage, create)?.title).toBe("B");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH=/Users/chuntsai/.nvm/versions/node/v24.6.0/bin:$PATH; node_modules/.bin/vitest run --config vitest.config.ts tests/unit/document-draft.test.ts > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t2.log`
Expected: `EXIT=1`, cannot resolve `@/lib/document-draft`.

- [ ] **Step 3: Write the implementation**

`src/lib/document-draft.ts`:

```ts
/**
 * An unsaved composer draft, kept in this tab's sessionStorage (composer spec
 * §5). A draft is never a revision: it lives only in the browser, and any
 * failure to read or write it means "no draft", never an error.
 */
export type DraftKey = { kind: "edit"; documentId: string } | { kind: "new"; workspaceId: string };
export type Draft = { title: string; markdown: string; baseRevisionId: string | null };
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const VERSION = 1;

export function draftStorageKey(key: DraftKey): string {
  return key.kind === "edit" ? `kh:draft:edit:${key.documentId}` : `kh:draft:new:${key.workspaceId}`;
}

export function readDraft(storage: DraftStorage | null, key: DraftKey): Draft | null {
  try {
    const raw = storage?.getItem(draftStorageKey(key));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return isStoredDraft(value) ? { title: value.title, markdown: value.markdown, baseRevisionId: value.baseRevisionId } : null;
  } catch {
    return null;
  }
}

/** Keeps the draft while it differs from what the composer opened with, and removes it once it does not. */
export function syncDraft(storage: DraftStorage | null, key: DraftKey, draft: Draft, initial: { title: string; markdown: string }): void {
  if (draft.title === initial.title && draft.markdown === initial.markdown) {
    clearDraft(storage, key);
    return;
  }
  try {
    storage?.setItem(draftStorageKey(key), JSON.stringify({ v: VERSION, ...draft }));
  } catch {
    // Over quota, or storage refused: the draft is simply not kept.
  }
}

export function clearDraft(storage: DraftStorage | null, key: DraftKey): void {
  try {
    storage?.removeItem(draftStorageKey(key));
  } catch {
    // Nothing to clear if storage cannot be reached.
  }
}

/** The tab's sessionStorage, or null where there is none (server) or it is refused (some private modes). */
export function browserDraftStorage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function isStoredDraft(value: unknown): value is Draft & { v: number } {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.v === VERSION &&
    typeof record.title === "string" &&
    typeof record.markdown === "string" &&
    (record.baseRevisionId === null || typeof record.baseRevisionId === "string")
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: the Step 2 command.
Expected: `EXIT=0`, 9 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/document-draft.ts tests/unit/document-draft.test.ts
git commit -m "feat(lib): keep an unsaved draft in the tab, and treat any storage failure as none

Claude-Session: https://claude.ai/code/session_0147bSAtofdFgcV3oVdWtipa"
```

---

### Task 3: Form keys learn preview

**Files:**
- Create: `src/lib/form-keys.ts`
- Modify: `src/components/knowledge/use-form-keys.ts` (whole file)
- Test: `tests/unit/form-keys.test.ts`

**Interfaces:**
- Produces:
  - `type FormKeyEvent = { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; isComposing: boolean; keyCode: number }`
  - `type FormKeyIntent = "save" | "toggle-preview" | "exit-preview" | "cancel" | null`
  - `formKeyIntent(event: FormKeyEvent, state: { dirty: boolean; busy: boolean; previewing: boolean; canPreview: boolean }): FormKeyIntent`
  - `useFormKeys({ dirty, busy, onCancel, preview? }: { dirty: boolean; busy: boolean; onCancel: () => void; preview?: { active: boolean; toggle: () => void } }): (event: KeyboardEvent<HTMLFormElement>) => void` — same name and call shape as today, `preview` added.

- [ ] **Step 1: Write the failing test**

`tests/unit/form-keys.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formKeyIntent, type FormKeyEvent } from "@/lib/form-keys";

function key(overrides: Partial<FormKeyEvent> = {}): FormKeyEvent {
  return { key: "a", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, isComposing: false, keyCode: 65, ...overrides };
}

const editing = { dirty: false, busy: false, previewing: false, canPreview: true };

describe("formKeyIntent", () => {
  it("saves on ⌘Enter and Ctrl Enter", () => {
    expect(formKeyIntent(key({ key: "Enter", metaKey: true }), editing)).toBe("save");
    expect(formKeyIntent(key({ key: "Enter", ctrlKey: true }), editing)).toBe("save");
    expect(formKeyIntent(key({ key: "Enter", metaKey: true }), { ...editing, previewing: true })).toBe("save");
  });

  it("does nothing while an input method is composing", () => {
    expect(formKeyIntent(key({ key: "Enter", metaKey: true, isComposing: true }), editing)).toBeNull();
    expect(formKeyIntent(key({ key: "Escape", keyCode: 229 }), editing)).toBeNull();
  });

  it("toggles preview on ⌘⇧P and Ctrl ⇧P, whatever case the key reports", () => {
    expect(formKeyIntent(key({ key: "p", metaKey: true, shiftKey: true }), editing)).toBe("toggle-preview");
    expect(formKeyIntent(key({ key: "P", ctrlKey: true, shiftKey: true }), editing)).toBe("toggle-preview");
    expect(formKeyIntent(key({ key: "P", metaKey: true, shiftKey: true }), { ...editing, previewing: true })).toBe("toggle-preview");
  });

  it("leaves ⌘P, ⌥⌘⇧P and forms without a preview alone", () => {
    expect(formKeyIntent(key({ key: "p", metaKey: true }), editing)).toBeNull();
    expect(formKeyIntent(key({ key: "p", metaKey: true, shiftKey: true, altKey: true }), editing)).toBeNull();
    expect(formKeyIntent(key({ key: "p", metaKey: true, shiftKey: true }), { ...editing, canPreview: false })).toBeNull();
  });

  it("uses Esc in preview to return to editing, changes or not", () => {
    expect(formKeyIntent(key({ key: "Escape" }), { ...editing, previewing: true, dirty: true })).toBe("exit-preview");
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

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH=/Users/chuntsai/.nvm/versions/node/v24.6.0/bin:$PATH; node_modules/.bin/vitest run --config vitest.config.ts tests/unit/form-keys.test.ts > /tmp/t3.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t3.log`
Expected: `EXIT=1`, cannot resolve `@/lib/form-keys`.

- [ ] **Step 3: Write the implementation**

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

export type FormKeyIntent = "save" | "toggle-preview" | "exit-preview" | "cancel" | null;

/**
 * What a key pressed inside a document form asks for. Keyboard shortcuts spec
 * §5; composer spec §6 adds preview. Esc never discards changes: in preview it
 * returns to editing, and it leaves only a form nothing has been typed into.
 */
export function formKeyIntent(
  event: FormKeyEvent,
  state: { dirty: boolean; busy: boolean; previewing: boolean; canPreview: boolean },
): FormKeyIntent {
  // An input method uses Enter and Esc to finish or abandon a composition.
  if (event.isComposing || event.keyCode === 229) return null;
  const command = event.metaKey || event.ctrlKey;
  if (command && event.key === "Enter") return "save";
  if (command && event.shiftKey && !event.altKey && event.key.toLowerCase() === "p") {
    return state.canPreview ? "toggle-preview" : null;
  }
  if (event.key !== "Escape") return null;
  if (state.previewing) return "exit-preview";
  return !state.dirty && !state.busy ? "cancel" : null;
}
```

`src/components/knowledge/use-form-keys.ts` (replace the file):

```ts
"use client";

import type { KeyboardEvent } from "react";
import { formKeyIntent } from "@/lib/form-keys";

/**
 * ⌘Enter saves, ⌘⇧P toggles preview and Esc cancels, inside a document form.
 * The rules are `formKeyIntent`'s; this only carries them out.
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
  preview,
}: {
  dirty: boolean;
  busy: boolean;
  onCancel: () => void;
  preview?: { active: boolean; toggle: () => void };
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
      { dirty, busy, previewing: preview?.active ?? false, canPreview: preview !== undefined },
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
    else preview?.toggle();
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: the Step 2 command. Expected: `EXIT=0`, 7 tests passed.
Then: `export PATH=/Users/chuntsai/.nvm/versions/node/v24.6.0/bin:$PATH; node_modules/.bin/tsc --noEmit > /tmp/t3b.log 2>&1; echo "EXIT=$?"` — expected `EXIT=0` (both existing callers still compile: `preview` is optional).

- [ ] **Step 5: Commit**

```bash
git add src/lib/form-keys.ts src/components/knowledge/use-form-keys.ts tests/unit/form-keys.test.ts
git commit -m "feat(ui): form keys learn ⌘⇧P for preview, and Esc leaves preview before the form

Claude-Session: https://claude.ai/code/session_0147bSAtofdFgcV3oVdWtipa"
```

---

### Task 4: Shared breadcrumb, location and article

The reader and the composer must draw the same header row and the same article. This task extracts them with no visible change to the reader.

**Files:**
- Create: `src/components/knowledge/document-breadcrumb.tsx`
- Create: `src/server/document-location.ts`
- Modify: `src/components/knowledge/document-header.tsx` (the `<nav aria-label="Breadcrumb">…</nav>` block and imports)
- Modify: `src/components/knowledge/document-inspector.tsx:17`
- Modify: `src/components/knowledge/document-viewer.tsx`
- Modify: `src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/page.tsx:1-35,96-100`
- Test: `tests/unit/document-location.test.ts`

**Interfaces:**
- Produces:
  - `type DocumentBreadcrumbSegment = { label: string; href?: string }` (moved; same shape)
  - `<DocumentBreadcrumb segments={DocumentBreadcrumbSegment[]} />`
  - `documentLocation(workspaceId: string, sourceId: string, sourceName: string, tree: KnowledgeTreeItem[], documentId: string): DocumentBreadcrumbSegment[]` — source and folders, **not** the document
  - `<MarkdownArticle markdown={string} />`

- [ ] **Step 1: Write the failing test**

`tests/unit/document-location.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { KnowledgeTreeItem } from "@/modules/knowledge/application/knowledge-query-service";
import { documentLocation } from "@/server/document-location";

function folder(id: string, label: string, parentId: string | null): KnowledgeTreeItem {
  return { type: "folder", id, parentId, label, position: 0, status: "ACTIVE" };
}
function doc(id: string, documentId: string, parentId: string | null): KnowledgeTreeItem {
  return { type: "document", id, parentId, documentId, label: "Doc", currentRevisionId: "rev", position: 0, status: "ACTIVE" };
}

describe("documentLocation", () => {
  it("leads from the source through every folder, outermost first, and stops before the document", () => {
    const tree = [folder("f1", "HR", null), folder("f2", "Leave", "f1"), doc("n1", "d1", "f2")];
    expect(documentLocation("w", "s", "Notes", tree, "d1")).toEqual([
      { label: "Notes", href: "/w/w/knowledge/s" },
      { label: "HR" },
      { label: "Leave" },
    ]);
  });

  it("is just the source for a document at the root or not in the tree", () => {
    expect(documentLocation("w", "s", "Notes", [doc("n1", "d1", null)], "d1")).toEqual([{ label: "Notes", href: "/w/w/knowledge/s" }]);
    expect(documentLocation("w", "s", "Notes", [], "missing")).toEqual([{ label: "Notes", href: "/w/w/knowledge/s" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH=/Users/chuntsai/.nvm/versions/node/v24.6.0/bin:$PATH; node_modules/.bin/vitest run --config vitest.config.ts tests/unit/document-location.test.ts > /tmp/t4.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t4.log`
Expected: `EXIT=1`, cannot resolve `@/server/document-location`.

- [ ] **Step 3: Create the location function**

`src/server/document-location.ts` (the loop is the one in `[documentId]/page.tsx`'s `buildBreadcrumb`, minus its final title segment):

```ts
import type { KnowledgeTreeItem } from "@/modules/knowledge/application/knowledge-query-service";
import type { DocumentBreadcrumbSegment } from "@/components/knowledge/document-breadcrumb";

/** Source › folders… leading to a document, without the document itself. The reader and the composer each add the title. */
export function documentLocation(
  workspaceId: string,
  sourceId: string,
  sourceName: string,
  tree: KnowledgeTreeItem[],
  documentId: string,
): DocumentBreadcrumbSegment[] {
  const segments: DocumentBreadcrumbSegment[] = [{ label: sourceName, href: `/w/${workspaceId}/knowledge/${sourceId}` }];
  const byId = new Map(tree.map((item) => [item.id, item]));
  const node = tree.find((item) => item.type === "document" && item.documentId === documentId);
  if (!node) return segments;
  const folders: string[] = [];
  let current = node.parentId ? byId.get(node.parentId) : undefined;
  while (current) {
    if (current.type === "folder") folders.unshift(current.label);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  for (const folder of folders) segments.push({ label: folder });
  return segments;
}
```

- [ ] **Step 4: Create the breadcrumb component**

`src/components/knowledge/document-breadcrumb.tsx` — move the `<nav>` block from `document-header.tsx` verbatim:

```tsx
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export type DocumentBreadcrumbSegment = {
  label: string;
  href?: string;
};

/** The reader's `location › title` line; the composer draws the same one. */
export function DocumentBreadcrumb({ segments }: { segments: DocumentBreadcrumbSegment[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
      <ol className="flex min-w-0 items-center gap-1 text-body-sm text-kh-text-muted">
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          return (
            <li key={`${segment.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
              {segment.href && !isLast ? (
                <Link href={segment.href} className="shrink-0 rounded-md hover:text-kh-text hover:underline kh-focus-ring">
                  {segment.label}
                </Link>
              ) : (
                <span aria-current={isLast ? "page" : undefined} className="truncate">
                  {segment.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
```

- [ ] **Step 5: Use it in the header and the inspector**

In `src/components/knowledge/document-header.tsx`:
- Delete the `export type DocumentBreadcrumbSegment = { … };` block.
- Change the imports: `import { LockKeyhole, PanelRight } from "lucide-react";` (drop `ChevronRight`), keep `Link` (the revision banner uses it), and add `import { DocumentBreadcrumb, type DocumentBreadcrumbSegment } from "./document-breadcrumb";`.
- Replace the whole `<nav aria-label="Breadcrumb" …>…</nav>` element with `<DocumentBreadcrumb segments={breadcrumb} />`.

In `src/components/knowledge/document-inspector.tsx:17`, replace
`import { DocumentHeader, type DocumentBreadcrumbSegment } from "./document-header";`
with
```ts
import { DocumentHeader } from "./document-header";
import type { DocumentBreadcrumbSegment } from "./document-breadcrumb";
```

- [ ] **Step 6: Export the article**

Replace `src/components/knowledge/document-viewer.tsx` with:

```tsx
import type { KnowledgeQueryService } from "@/modules/knowledge/application/knowledge-query-service";
import { MarkdownRenderer } from "./markdown-renderer";

type DocumentDetails = Awaited<ReturnType<KnowledgeQueryService["getDocument"]>>;

/** Rendered Markdown as the reader shows it; the composer's preview is this same element. */
export function MarkdownArticle({ markdown }: { markdown: string }) {
  return (
    <article className="min-w-0 [&>div>:first-child]:mt-0">
      <MarkdownRenderer markdown={markdown} />
    </article>
  );
}

export function DocumentViewer({ view, selectedRevision }: { view: DocumentDetails; selectedRevision?: DocumentDetails["currentRevision"] }) {
  const displayed = selectedRevision ?? view.currentRevision;
  return <MarkdownArticle markdown={displayed.markdown} />;
}
```

- [ ] **Step 7: Use the location in the reading page**

In `src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/page.tsx`:
- Delete the `buildBreadcrumb` function and the `KnowledgeTreeItem` and `DocumentBreadcrumbSegment` imports.
- Add `import { documentLocation } from "@/server/document-location";`.
- Replace the `const breadcrumb = explorer ? buildBreadcrumb(…) : [{ label: selectedRevision.title }];` statement with:

```ts
  const breadcrumb = explorer
    ? [...documentLocation(workspaceId, sourceId, explorer.source.name, explorer.tree, documentId), { label: selectedRevision.title }]
    : [{ label: selectedRevision.title }];
```

- [ ] **Step 8: Verify**

Run: `export PATH=/Users/chuntsai/.nvm/versions/node/v24.6.0/bin:$PATH; node_modules/.bin/vitest run --config vitest.config.ts tests/unit/document-location.test.ts > /tmp/t4.log 2>&1; echo "EXIT=$?"` — expected `EXIT=0`, 2 passed.
Then: `make verify > /tmp/t4v.log 2>&1; echo "EXIT=$?"` — expected `EXIT=0` (unit, typecheck, lint, build).

- [ ] **Step 9: Commit**

```bash
git add src/components/knowledge/document-breadcrumb.tsx src/server/document-location.ts src/components/knowledge/document-header.tsx src/components/knowledge/document-inspector.tsx src/components/knowledge/document-viewer.tsx "src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/page.tsx" tests/unit/document-location.test.ts
git commit -m "refactor(ui): the breadcrumb, the document's location and the article become shareable

Claude-Session: https://claude.ai/code/session_0147bSAtofdFgcV3oVdWtipa"
```

---

### Task 5: The composer, on the edit page

**Files:**
- Create: `src/components/knowledge/document-composer.tsx`
- Modify: `src/components/knowledge/document-editor.tsx` (whole file)
- Modify: `src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/edit/page.tsx`
- Modify: `tests/e2e/phase5-authoring.spec.ts:140-160` (conflict test)
- Create: `tests/e2e/document-composer.spec.ts`

**Interfaces:**
- Consumes: Task 1 `resolveAuthoredTitle`, `carryTitle`; Task 2 `DraftKey`, `readDraft`, `syncDraft`, `clearDraft`, `browserDraftStorage`; Task 3 `useFormKeys({ dirty, busy, onCancel, preview })`; Task 4 `DocumentBreadcrumb`, `DocumentBreadcrumbSegment`, `MarkdownArticle`, `documentLocation`.
- Produces:
  - `type ComposerSubmit = { title: string; markdown: string; expectedRevisionId: string | null }`
  - `<DocumentComposer draftKey location untitledLabel metadataTitle initialTitle initialMarkdown currentRevisionId submitLabel cancelHref onSubmit conflictHref footer? />` with `onSubmit: (input: ComposerSubmit) => Promise<string>` returning the href the document now lives at, and throwing (via `governanceRequest`) on refusal.
  - `DocumentEditor` props: `{ workspaceId, sourceId, documentId, location: DocumentBreadcrumbSegment[], metadataTitle: unknown, currentRevisionId: string, initialTitle: string, initialMarkdown: string }`.

- [ ] **Step 1: Write the failing e2e tests**

`tests/e2e/document-composer.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";

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

async function openEditor(page: Page, documentUrl: string) {
  await page.goto(`${documentUrl}/edit`);
  const body = composer(page).getByLabel("Markdown");
  await expect(body).toBeEditable(ROUND_TRIP);
  return body;
}

test("a document that opens with an H1 is named by it, with no title field", async ({ page }) => {
  const before = unique("Composer H1");
  const after = unique("Composer Renamed");
  const url = await createNote(page, before, `# ${before}\n\nbody`);
  const body = await openEditor(page, url);
  await expect(composer(page).getByLabel("Title", { exact: true })).toHaveCount(0);

  await body.fill(`# ${after}\n\nbody`);
  await expect(composer(page).getByRole("navigation", { name: "Breadcrumb" })).toContainText(after);
  await composer(page).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("treeitem", { name: after, exact: true })).toBeVisible(ROUND_TRIP);
});

test("deleting the opening H1 brings back the title field, filled with it", async ({ page }) => {
  const title = unique("Carry");
  const url = await createNote(page, title, `# ${title}\n\nbody`);
  const body = await openEditor(page, url);
  await body.fill("body");
  await expect(composer(page).getByLabel("Title", { exact: true })).toHaveValue(title);
});

test("a frontmatter title survives editing the H1", async ({ page }) => {
  const title = unique("Frontmatter Title");
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  // Enabled once hydrated and authorized, on the old form and the composer alike.
  await expect(page.locator('input[type="file"]')).toBeEnabled(ROUND_TRIP);
  await page.setInputFiles('input[type="file"]', {
    name: "fm.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(`---\ntitle: ${title}\n---\n\n# A different heading\n\ntext\n`, "utf8"),
  });
  await expect(page).not.toHaveURL(/\/new$/, ROUND_TRIP);

  const body = await openEditor(page, page.url());
  await expect(composer(page).getByText("標題來自上傳檔案的 frontmatter")).toBeVisible();
  await body.fill("# Another heading entirely\n\ntext");
  await composer(page).getByRole("button", { name: "Save" }).click();
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
  await expect(page.getByRole("treeitem", { name: title, exact: true })).toBeVisible(ROUND_TRIP);
});

test("preview shows the saved look and returns to the same text and caret", async ({ page }) => {
  const url = await createNote(page, unique("Preview"));
  const body = await openEditor(page, url);
  await body.fill("Some **bold** words");
  await body.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(4, 4));

  await composer(page).getByRole("button", { name: "Preview" }).click();
  const preview = composer(page).getByRole("region", { name: "Preview" });
  await expect(preview.locator("strong")).toHaveText("bold");
  await expect(body).toBeHidden();

  await page.keyboard.press("Escape");
  await expect(body).toBeVisible();
  await expect(body).toBeFocused();
  await expect(body).toHaveValue("Some **bold** words");
  expect(await body.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(4);

  await page.keyboard.press("ControlOrMeta+Shift+P");
  await expect(preview).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
  await expect(page.locator("article").first().locator("strong")).toHaveText("bold", ROUND_TRIP);
});

test("an unsaved edit survives leaving and is offered back on return", async ({ page }) => {
  const title = unique("Draft");
  const url = await createNote(page, title);
  const body = await openEditor(page, url);
  await body.fill("draft text");

  await page.getByRole("treeitem", { name: title, exact: true }).click();
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);

  await openEditor(page, url);
  await expect(composer(page).getByRole("status").filter({ hasText: "已還原未存的修改" })).toBeVisible();
  await expect(body).toHaveValue("draft text");

  await composer(page).getByRole("button", { name: "捨棄" }).click();
  await expect(body).toHaveValue("");
  await page.reload();
  await expect(body).toBeEditable(ROUND_TRIP);
  await expect(composer(page).getByRole("status").filter({ hasText: "已還原" })).toHaveCount(0);
});

test("a restored draft on a document someone changed meanwhile conflicts instead of overwriting", async ({ page }) => {
  const title = unique("Stale Draft");
  const url = await createNote(page, title);
  const body = await openEditor(page, url);
  await body.fill("mine");
  await page.getByRole("treeitem", { name: title, exact: true }).click();
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);

  // A new page is a new tab, with its own sessionStorage.
  const other = await page.context().newPage();
  const theirs = await openEditor(other, url);
  await theirs.fill("theirs");
  await composer(other).getByRole("button", { name: "Save" }).click();
  await expect(other.locator("article").first().getByText("theirs")).toBeVisible(ROUND_TRIP);
  await other.close();

  await openEditor(page, url);
  await expect(composer(page).getByRole("status").filter({ hasText: "被更新過" })).toBeVisible();
  await expect(body).toHaveValue("mine");
  await composer(page).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "已被其他人更新" })).toBeVisible(ROUND_TRIP);
  await expect(body).toHaveValue("mine");

  await composer(page).getByRole("button", { name: "載入最新版本（捨棄你的修改）" }).click();
  await expect(body).toHaveValue("theirs", ROUND_TRIP);
  await expect(composer(page).getByRole("status").filter({ hasText: "已還原" })).toHaveCount(0);
});

test("Cancel asks before discarding changes, and discarding clears the draft", async ({ page }) => {
  const url = await createNote(page, unique("Cancel"));
  const body = await openEditor(page, url);
  await body.fill("changed");

  page.once("dialog", (dialog) => {
    expect(dialog.message()).toBe("Discard changes?");
    void dialog.dismiss();
  });
  await composer(page).getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await expect(body).toHaveValue("changed");

  page.once("dialog", (dialog) => void dialog.accept());
  await composer(page).getByRole("button", { name: "Cancel" }).click();
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);

  await openEditor(page, url);
  await expect(body).toHaveValue("");
  await expect(composer(page).getByRole("status").filter({ hasText: "已還原" })).toHaveCount(0);
});
```

In `tests/e2e/phase5-authoring.spec.ts`, conflict test: add `pageB.on("dialog", (dialog) => void dialog.accept());` as the first line after `const pageB = await page.context().newPage();` (pageB is left dirty by a full load, which may raise `beforeunload`), and replace

```ts
  await expect(pageB.getByRole("link", { name: "重新載入最新版本" })).toBeVisible();
```
with
```ts
  await expect(pageB.getByRole("button", { name: "載入最新版本（捨棄你的修改）" })).toBeVisible();
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `make test-e2e > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "passed|failed|✘" /tmp/t5.log | tail -30`
Expected: `EXIT=1`; `document-composer.spec.ts` tests fail (no Preview button, a Title field shown for H1 documents, no draft restore) and the edited conflict assertion fails (the link is not yet a button). Every other spec passes.

- [ ] **Step 3: Write the composer**

`src/components/knowledge/document-composer.tsx`:

```tsx
"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/shell/use-hydrated";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { refreshOnArrival } from "@/components/shell/refresh-on-arrival";
import { GovernanceError, governanceFailure, type GovernanceFailure } from "@/components/workspaces/governance-error";
import { carryTitle, resolveAuthoredTitle } from "@/lib/authored-title";
import { browserDraftStorage, clearDraft, readDraft, syncDraft, type DraftKey } from "@/lib/document-draft";
import { DocumentBreadcrumb, type DocumentBreadcrumbSegment } from "./document-breadcrumb";
import { MarkdownArticle } from "./document-viewer";
import { useFormKeys } from "./use-form-keys";

export type ComposerSubmit = { title: string; markdown: string; expectedRevisionId: string | null };

/**
 * Writing a document, laid out like reading one (composer spec). The header row
 * is the reader's with the actions swapped; the column is the reader's with the
 * article swapped for its source. Everything that decides something lives in
 * `lib/`: the title in `authored-title`, the draft in `document-draft`, the keys
 * in `form-keys`.
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
  footer?: ReactNode;
}) {
  const router = useRouter();
  const { confirmed } = useWorkspaceAuthorization();
  // Everything waits for hydration; see `use-hydrated` for what a native submit costs.
  const hydrated = useHydrated();
  const [title, setTitle] = useState(initialTitle);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [baseRevisionId, setBaseRevisionId] = useState(currentRevisionId);
  const [restored, setRestored] = useState<"current" | "stale" | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GovernanceFailure | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const restoreTried = useRef(false);
  const focusedOnce = useRef(false);
  const leaving = useRef(false);

  const resolved = resolveAuthoredTitle({ metadataTitle, markdown, typedTitle: title });
  const dirty = title !== initialTitle || markdown !== initialMarkdown;
  const ready = hydrated && !busy;
  const initial = { title: initialTitle, markdown: initialMarkdown };

  // Once, after hydration: the server has no sessionStorage, and anything set
  // before hydration commits is overwritten by the server's values.
  useEffect(() => {
    if (!hydrated || restoreTried.current) return;
    restoreTried.current = true;
    const draft = readDraft(browserDraftStorage(), draftKey);
    if (!draft) return;
    setTitle(draft.title);
    setMarkdown(draft.markdown);
    setBaseRevisionId(draft.baseRevisionId);
    setRestored(draft.baseRevisionId === currentRevisionId ? "current" : "stale");
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
  // text. Later: whichever of text and preview is showing. A hidden textarea
  // keeps its selection, so returning to it puts the caret back where it was.
  useEffect(() => {
    if (!hydrated) return;
    if (previewing) {
      previewRef.current?.focus();
      return;
    }
    const textarea = textareaRef.current;
    if (focusedOnce.current) {
      textarea?.focus();
      return;
    }
    focusedOnce.current = true;
    if (titleRef.current && !titleRef.current.value) {
      titleRef.current.focus();
      return;
    }
    textarea?.focus();
    textarea?.setSelectionRange(0, 0);
  }, [hydrated, previewing]);

  // The text grows with its content, so the page scrolls, not a box inside it.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || previewing) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [markdown, previewing]);

  function keep(nextTitle: string, nextMarkdown: string) {
    syncDraft(browserDraftStorage(), draftKey, { title: nextTitle, markdown: nextMarkdown, baseRevisionId }, initial);
  }

  function changeMarkdown(next: string) {
    const after = resolveAuthoredTitle({ metadataTitle, markdown: next, typedTitle: title });
    const nextTitle = carryTitle(resolved, after, title);
    setMarkdown(next);
    setTitle(nextTitle);
    keep(nextTitle, next);
  }

  function changeTitle(next: string) {
    setTitle(next);
    keep(next, markdown);
  }

  function discardDraft() {
    clearDraft(browserDraftStorage(), draftKey);
    setTitle(initialTitle);
    setMarkdown(initialMarkdown);
    setBaseRevisionId(currentRevisionId);
    setRestored(null);
  }

  function cancel() {
    if (dirty && !window.confirm("Discard changes?")) return;
    clearDraft(browserDraftStorage(), draftKey);
    router.push(cancelHref);
  }

  function loadLatest() {
    if (!conflictHref) return;
    clearDraft(browserDraftStorage(), draftKey);
    leaving.current = true;
    window.location.assign(conflictHref);
  }

  async function save() {
    if (busy || !confirmed || !resolved.title) return;
    setBusy(true);
    setError(null);
    try {
      const href = await onSubmit({ title: resolved.title, markdown, expectedRevisionId: baseRevisionId });
      clearDraft(browserDraftStorage(), draftKey);
      leaving.current = true;
      // Push only, then refresh on arrival: a refresh fired beside the push
      // discards it (keyboard-shortcuts spec §9, #49).
      refreshOnArrival(href);
      router.push(href);
    } catch (failure) {
      setError(governanceFailure(failure));
    } finally {
      setBusy(false);
    }
  }

  const togglePreview = () => setPreviewing((was) => !was);
  const onKeyDown = useFormKeys({ dirty, busy, onCancel: cancel, preview: { active: previewing, toggle: togglePreview } });
  const conflict = error?.code === "REVISION_CONFLICT";
  const untitled = !resolved.title;

  return (
    <form onKeyDown={onKeyDown} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="kh-reading-column pb-3 pt-5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <DocumentBreadcrumb segments={[...location, { label: resolved.title || untitledLabel }]} />
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              aria-pressed={previewing}
              aria-keyshortcuts="Meta+Shift+P Control+Shift+P"
              title="Preview (⌘⇧P)"
              className="aria-pressed:bg-kh-bg-selected aria-pressed:text-kh-text"
              disabled={!hydrated}
              onClick={togglePreview}
            >
              Preview
            </Button>
            <Button type="button" variant="secondary" title="Cancel (Esc)" disabled={busy} onClick={cancel}>
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
            hidden={previewing}
            onChange={(event) => changeTitle(event.target.value)}
            className="w-full border-0 bg-transparent p-0 text-heading font-semibold tracking-tight text-kh-text outline-none placeholder:text-kh-text-muted"
          />
        ) : null}
        {/* No display utility here: it would override [hidden] (plan Global Constraints). */}
        <textarea
          ref={textareaRef}
          aria-label="Markdown"
          placeholder="Write in Markdown. Start with # to name the document."
          value={markdown}
          disabled={!ready}
          hidden={previewing}
          onChange={(event) => changeMarkdown(event.target.value)}
          className="min-h-[12rem] w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-reading text-kh-text outline-none placeholder:text-kh-text-muted"
        />
        {previewing ? (
          <div ref={previewRef} role="region" aria-label="Preview" tabIndex={-1} className="outline-none">
            {resolved.source === "TYPED" && resolved.title ? (
              <h1 className="mb-4 text-heading font-semibold tracking-tight text-kh-text">{resolved.title}</h1>
            ) : null}
            <MarkdownArticle markdown={markdown} />
          </div>
        ) : null}
        {footer}
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Make the editor a wrapper**

Replace `src/components/knowledge/document-editor.tsx` with:

```tsx
"use client";

import { governanceRequest } from "@/components/workspaces/governance-error";
import type { DocumentBreadcrumbSegment } from "./document-breadcrumb";
import { DocumentComposer } from "./document-composer";

export function DocumentEditor({
  workspaceId,
  sourceId,
  documentId,
  location,
  metadataTitle,
  currentRevisionId,
  initialTitle,
  initialMarkdown,
}: {
  workspaceId: string;
  sourceId: string;
  documentId: string;
  location: DocumentBreadcrumbSegment[];
  metadataTitle: unknown;
  currentRevisionId: string;
  initialTitle: string;
  initialMarkdown: string;
}) {
  const documentHref = `/w/${workspaceId}/knowledge/${sourceId}/${documentId}`;
  return (
    <DocumentComposer
      draftKey={{ kind: "edit", documentId }}
      location={location}
      untitledLabel="Untitled"
      metadataTitle={metadataTitle}
      initialTitle={initialTitle}
      initialMarkdown={initialMarkdown}
      currentRevisionId={currentRevisionId}
      submitLabel="Save"
      cancelHref={documentHref}
      conflictHref={`${documentHref}/edit`}
      onSubmit={async ({ title, markdown, expectedRevisionId }) => {
        await governanceRequest(`/api/documents/${documentId}`, "PATCH", { title, markdown, expectedCurrentRevisionId: expectedRevisionId });
        return documentHref;
      }}
    />
  );
}
```

- [ ] **Step 5: Pass location and metadata from the edit route**

In `src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/edit/page.tsx`, add `import { documentLocation } from "@/server/document-location";` and replace the returned element with:

```tsx
  const current = model.view.currentRevision;
  return (
    <DocumentEditor
      workspaceId={workspaceId}
      sourceId={sourceId}
      documentId={documentId}
      location={documentLocation(workspaceId, sourceId, explorer.source.name, explorer.tree, documentId)}
      metadataTitle={current.metadata.title}
      currentRevisionId={current.id}
      initialTitle={current.title}
      initialMarkdown={current.markdown}
    />
  );
```

The gates above it (`notFound()` for archived workspace, no `canWrite`, not `HUB_MANAGED`, not `ACTIVE`) stay exactly as they are.

- [ ] **Step 6: Verify**

Run: `make verify > /tmp/t5v.log 2>&1; echo "EXIT=$?"` — expected `EXIT=0`.
Run: `make test-e2e > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "passed|failed|✘" /tmp/t5.log | tail -30`
Expected: `EXIT=0`, no failures, no flaky. `/new` is still the old form at this point and its tests are untouched.

- [ ] **Step 7: Commit**

```bash
git add src/components/knowledge/document-composer.tsx src/components/knowledge/document-editor.tsx "src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/edit/page.tsx" tests/e2e/document-composer.spec.ts tests/e2e/phase5-authoring.spec.ts
git commit -m "feat(ui): edit a document where it is read — title follows the H1, preview, drafts kept in the tab

Claude-Session: https://claude.ai/code/session_0147bSAtofdFgcV3oVdWtipa"
```

---

### Task 6: The composer, on the new-document page

**Files:**
- Modify: `src/components/knowledge/new-document-form.tsx` (whole file)
- Modify: `src/app/w/[workspaceId]/knowledge/new/page.tsx` (whole file)
- Modify: `tests/e2e/phase5-authoring.spec.ts` (lines 36, 47, 55, 81, 125, 173)
- Modify: `tests/e2e/keyboard-shortcuts.spec.ts:78`
- Modify: `tests/e2e/share-link.spec.ts:23-24`
- Modify: `tests/e2e/document-composer.spec.ts` (append one test)

**Interfaces:**
- Consumes: Task 5 `DocumentComposer`, `ComposerSubmit`.
- Produces: `NewDocumentForm({ workspaceId: string; workspaceName: string })` — the `variant` prop is gone (it had one caller, always `"empty"`).

- [ ] **Step 1: Update the tests to the new field names, and add the H1-only test**

In `tests/e2e/phase5-authoring.spec.ts`, add below `ROUND_TRIP`:

```ts
/** The new-document page's title field. main form + first(): the duplicate-DOM quirk noted below. */
function newTitle(page: Page) {
  return page.locator("main form").first().getByLabel("Title", { exact: true });
}
```

and replace every `page.getByLabel("Document title")` (lines 36, 47, 55, 81, 125, 173) with `newTitle(page)`.

In `tests/e2e/keyboard-shortcuts.spec.ts:78`, replace `page.getByLabel("Document title")` with `page.locator("main form").first().getByLabel("Title", { exact: true })`.

In `tests/e2e/share-link.spec.ts:23-24`, replace the two `fill` lines with:

```ts
    const form = page.locator("main form").first();
    await form.getByLabel("Title", { exact: true }).fill(title);
    await form.getByLabel("Markdown").fill(body);
```

Append to `tests/e2e/document-composer.spec.ts`:

```ts
test("a new document can be named by its H1 alone", async ({ page }) => {
  const title = unique("Only H1");
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  const form = composer(page);
  await expect(form.getByLabel("Title", { exact: true })).toBeEditable(ROUND_TRIP);
  await form.getByLabel("Markdown").fill(`# ${title}\n\nbody`);
  await expect(form.getByLabel("Title", { exact: true })).toHaveCount(0);
  await form.getByRole("button", { name: "Create document" }).click();
  await expect(page.getByRole("treeitem", { name: title, exact: true })).toBeVisible(ROUND_TRIP);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `make test-e2e > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "passed|failed|✘" /tmp/t6.log | tail -30`
Expected: `EXIT=1`; tests that open `/new` fail on the missing `Title`/`Markdown` labels.

- [ ] **Step 3: Make the form a wrapper**

Replace `src/components/knowledge/new-document-form.tsx` with:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { refreshOnArrival } from "@/components/shell/refresh-on-arrival";
import { GovernanceError, governanceFailure, governanceRequest, type GovernanceFailure } from "@/components/workspaces/governance-error";
import { DocumentComposer } from "./document-composer";

type Created = { documentId: string; sourceId: string };

export function NewDocumentForm({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const router = useRouter();
  const { access, confirmed } = useWorkspaceAuthorization();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<GovernanceFailure | null>(null);

  if (!access.actions.canWrite) return null;
  const listHref = `/w/${workspaceId}/knowledge`;

  async function create(body: unknown): Promise<string> {
    const created = await governanceRequest<Created>(`/api/workspaces/${workspaceId}/documents`, "POST", body);
    return `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`;
  }

  // Upload bypasses the composer: the file is the document, and the server
  // resolves its title the way folder import does (frontmatter → H1 → filename).
  async function upload(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      let markdown: string;
      try {
        markdown = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      } catch {
        setUploadError({ code: "INVALID_ENCODING", message: "這個檔案不是有效的 UTF-8 文字，無法上傳。" });
        return;
      }
      const href = await create({ filename: file.name, markdown });
      refreshOnArrival(href);
      router.push(href);
    } catch (failure) {
      setUploadError(governanceFailure(failure));
    } finally {
      setUploading(false);
    }
  }

  return (
    <DocumentComposer
      draftKey={{ kind: "new", workspaceId }}
      location={[{ label: "Documents", href: listHref }]}
      untitledLabel="New document"
      metadataTitle={undefined}
      initialTitle=""
      initialMarkdown=""
      currentRevisionId={null}
      submitLabel="Create document"
      cancelHref={listHref}
      conflictHref={null}
      onSubmit={({ title, markdown }) => create({ title, markdown })}
      footer={
        <div className="space-y-2 border-t border-kh-border pt-4">
          <label className="text-body text-kh-text-muted">
            <span className="cursor-pointer underline-offset-4 hover:underline">Upload .md</span> to Notes in {workspaceName} instead.
            <input
              type="file"
              accept=".md,.markdown"
              className="sr-only"
              disabled={uploading || !confirmed}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void upload(file);
              }}
            />
          </label>
          <GovernanceError error={uploadError} />
        </div>
      }
    />
  );
}
```

- [ ] **Step 4: Update the page**

Replace `src/app/w/[workspaceId]/knowledge/new/page.tsx` with (the composer draws the header row; the nested `<main>` inside the shell's `<main>` goes):

```tsx
import { notFound } from "next/navigation";
import { NewDocumentForm } from "@/components/knowledge/new-document-form";
import { getWorkspaceShellModel } from "@/server/knowledge-read";

export default async function NewNotePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const model = await getWorkspaceShellModel(workspaceId);
  if (!model?.access.actions.canWrite) notFound();
  return <NewDocumentForm workspaceId={workspaceId} workspaceName={model.workspace.name} />;
}
```

Check that nothing else imports `PageHeader` only for this page: `grep -rn "NewDocumentForm\|variant=\"sidebar\"" src` must list only `new/page.tsx` and `new-document-form.tsx`.

- [ ] **Step 5: Verify**

Run: `make verify > /tmp/t6v.log 2>&1; echo "EXIT=$?"` — expected `EXIT=0`.
Run: `make test-e2e > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "passed|failed|flaky" /tmp/t6.log | tail -10` — expected `EXIT=0`, no failures, no flaky.

- [ ] **Step 6: Commit**

```bash
git add src/components/knowledge/new-document-form.tsx "src/app/w/[workspaceId]/knowledge/new/page.tsx" tests/e2e/phase5-authoring.spec.ts tests/e2e/keyboard-shortcuts.spec.ts tests/e2e/share-link.spec.ts tests/e2e/document-composer.spec.ts
git commit -m "feat(ui): a new document is written in the same composer, and can be named by its H1

Claude-Session: https://claude.ai/code/session_0147bSAtofdFgcV3oVdWtipa"
```

---

### Task 7: Contracts, verification and the manual check

**Files:**
- Modify: `docs/superpowers/specs/frontend-design-language.md` (§10 Shortcuts; §10 focus text; §18 item 3 if present)
- Modify: `docs/superpowers/specs/2026-09-24-keyboard-shortcuts-design.md` (§5 intro)
- Modify: `docs/superpowers/specs/2026-09-28-document-composer-design.md` (status, §3 table, §6 if the Firefox check changes the key)
- Modify: `README.md` (canonical table)
- Create: `docs/superpowers/verification/2026-09-28-document-composer-verification.md`

- [ ] **Step 1: Check ⌘⇧P / Ctrl ⇧P in Firefox by hand**

`make dev`, open `http://127.0.0.1:3000/` in Firefox, create a note, open its editor, press `Ctrl ⇧ P` (Linux/Windows) or `⌘ ⇧ P` (macOS) with the caret in the textarea. Record: did the preview toggle, and did a private window open? If a private window opens, change the key in `src/lib/form-keys.ts`, `tests/unit/form-keys.test.ts`, the Preview button's `aria-keyshortcuts`/`title`, and `tests/e2e/document-composer.spec.ts`; re-run `make verify` and `make test-e2e`, then record both keys and the reason.

- [ ] **Step 2: Amend the design language**

In `docs/superpowers/specs/frontend-design-language.md` §10 "Shortcuts", replace the paragraph that starts "In the document forms, ⌘Enter saves" with:

```markdown
In the document composer (new and edit share it), ⌘Enter saves through the
form's own submit button, and only when that button is enabled. ⌘⇧P toggles
the preview. `Esc` in preview returns to the text; otherwise it leaves only a
composer nothing has been typed into, and with changes it does nothing. No key
discards a draft; Cancel is the one way to, and it asks first.

The composer's title field and text are the one place without the focus ring.
A text field matches `:focus-visible` for as long as it has focus, so a ring
would frame the whole canvas for the whole time anyone writes; the caret is the
focus indicator there. Its buttons keep the ring. Composer spec §6.
```

If §18 contains the item that begins "Editing is a different page from reading" (added by PR #61), replace that item's text with: `Closed: the composer (docs/superpowers/specs/2026-09-28-document-composer-design.md) edits in the reader's layout; the navigation guard it names became a tab-scoped draft that is restored on return.` If §18 has no such item (PR #61 not merged into this branch), leave §18 alone and say so in the PR description.

- [ ] **Step 3: Point the keyboard spec at the composer**

In `docs/superpowers/specs/2026-09-24-keyboard-shortcuts-design.md`, directly under `## 5. Forms: \`⌘Enter\` and \`Esc\``, insert:

```markdown
> 2026-09-28: The two forms have been merged into the document composer, adding `⌘⇧P` preview and `Esc` within preview. Current rules are in Section 6 of `2026-09-28-document-composer-design.md`; this section preserves the decisions made at the time.
```

- [ ] **Step 4: Bring the composer spec up to date**

In `docs/superpowers/specs/2026-09-28-document-composer-design.md`:
- Status row: `Implemented. See docs/superpowers/verification/2026-09-28-document-composer-verification.md for verification.`
- §3 table: delete the `useDraft` row, and change the draft store row's Responsibility to `Pure functions: read, write, and delete, with injected Storage; browserDraftStorage() obtains the tab's sessionStorage`. Under the table add: `During implementation, merge useDraft into the draft store: three calls do not need a hook.`
- §8 unit list: change `An H1 containing only an image → TYPED` to `An H1 containing only an image whose alt is empty → TYPED (alt text is extracted, as with import)`.

- [ ] **Step 5: README canonical table**

After the Keyboard Shortcuts rows in the "Current canonical documents" table (or after the Document Share Link rows if those rows are not on this branch yet), add:

```markdown
| [Document Composer Design](docs/superpowers/specs/2026-09-28-document-composer-design.md) | Document composer shared by creation and editing: reading layout, title follows H1, preview, and per-tab drafts |
| [Document Composer Implementation Plan](docs/superpowers/plans/2026-09-28-document-composer.md) | Composer tasks and tests |
```

- [ ] **Step 6: Write the verification record**

`docs/superpowers/verification/2026-09-28-document-composer-verification.md`, following the shape of `2026-09-23-document-share-link-verification.md`: the commit verified, the exact commands with their exit codes and pass counts (`make verify`, `make test-e2e`), the unit test files and case counts, each e2e case in `document-composer.spec.ts` by name, and the Step 1 Firefox result stated as observed (browser version, OS, what happened). Do not claim anything that was not run.

- [ ] **Step 7: Final gate and commit**

Run: `make verify > /tmp/t7v.log 2>&1; echo "EXIT=$?"` and `make test-e2e > /tmp/t7e.log 2>&1; echo "EXIT=$?"` — both `EXIT=0`.

```bash
git add docs README.md
git commit -m "docs: the composer in the design language, the keyboard spec and the README; verification record

Claude-Session: https://claude.ai/code/session_0147bSAtofdFgcV3oVdWtipa"
```
