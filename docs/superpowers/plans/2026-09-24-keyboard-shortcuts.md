# Keyboard Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `C` (Add to Notes), `E` (Edit document), `/` (open palette), and `⌘Enter`/`Esc` in the two document forms, and show each shortcut in the palette and on button tooltips.

**Architecture:** Single-key shortcuts are bound inside QuickSearch's existing `window` `keydown` listener, which already holds the registry's palette actions (with the document being read as target) and the action runner; the registry's existing `Action.shortcut` field is the one source for binding, `aria-keyshortcuts` and the displayed label. A pure predicate in `src/lib/shortcut-keys.ts` decides whether a key event may act as a single-key shortcut. Form keys are an `onKeyDown` on each `<form>`, shared through `use-form-keys.ts`.

**Tech Stack:** Next.js (App Router), React, TypeScript, Tailwind (replaced scales — see Global Constraints), Base UI, Vitest (unit, `renderToStaticMarkup` for components, no jsdom), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-09-24-keyboard-shortcuts-design.md`

## Global Constraints

- Tailwind `fontSize`, `borderRadius`, `boxShadow`, `transitionDuration`, `padding`, `margin`, `gap`, `space` scales are **replaced**: only contract token names compile (`text-micro`, `rounded-sm`, `px-1`, …). `rounded`, `text-xs`, `px-7` produce no CSS.
- No colour outside `src/app/globals.css` tokens; use `kh-*` classes.
- `kbd` takes radius `sm` (contract §5).
- One focus idiom: `kh-focus-ring`; do not add another.
- Single-key shortcuts fire only when: no `⌘`/`Ctrl`/`Alt`; not composing (`isComposing` or `keyCode === 229`); target not inside `input, textarea, select, [contenteditable]:not([contenteditable="false"])`; target not inside `[role="dialog"], [role="menu"], [role="listbox"]`; not `repeat`; no Shift, except for `/`.
- Compare `event.key` (lower-cased), never `event.code`.
- `E` acts only on the document being read, and only when the registry offers `document.edit`. Do not re-implement the availability rules.
- Row (right-click) menus show **no** shortcut hints.
- In the forms, `Esc` leaves only when the content is unchanged; when changed it does nothing. `Esc` never discards a draft.
- No new npm dependencies.
- **This machine's shell:** bare `npm`, `npx` and `node` are shadowed by an nvm function and fail with `command not found: _nvm_load`. Always `export PATH=/Users/chuntsai/.nvm/versions/node/v24.6.0/bin:$PATH` and call `node_modules/.bin/<tool>` directly. Never pipe a test command into `tail`/`head` without printing its exit code: `cmd > log 2>&1; echo "EXIT=$?"`.
- Commit messages end with the line `Claude-Session: https://claude.ai/code/session_01G1pWCcBMKrXn91HSNQSodL`.

## File Structure

```text
Create  src/lib/shortcut-keys.ts                     isSingleKeyShortcut(), shortcutLabel() — pure
Create  src/components/ui/kbd.tsx                    <Kbd> primitive (radius sm)
Create  src/components/knowledge/use-form-keys.ts    onKeyDown for the two document forms
Create  tests/unit/shortcut-keys.test.ts
Create  tests/e2e/keyboard-shortcuts.spec.ts
Modify  src/components/actions/action-registry.ts    shortcut "C" on create.document, "E" on document.edit
Modify  src/components/search/quick-search.tsx       "/", "C", "E" binding; <Kbd> on rows and the ⌘K button; tooltip
Modify  src/components/knowledge/document-header.tsx Edit: title + aria-keyshortcuts
Modify  src/components/knowledge/source-sidebar.tsx  "+": title + aria-keyshortcuts
Modify  src/components/knowledge/document-editor.tsx useFormKeys; button titles
Modify  src/components/knowledge/new-document-form.tsx useFormKeys; cancel() extracted; button titles
Modify  tests/unit/action-registry.test.ts           shortcut assertions
Modify  tests/unit/ui-primitives.test.tsx            Kbd render case
Modify  docs/superpowers/specs/frontend-design-language.md  §10 amendment
```

Commands used throughout (run from the repo root):

```bash
export PATH=/Users/chuntsai/.nvm/versions/node/v24.6.0/bin:$PATH
node_modules/.bin/vitest run --config vitest.config.ts <file>          # one unit file
node_modules/.bin/tsx scripts/test/e2e.ts <spec>                        # e2e (needs MariaDB: make db-up)
make verify > /tmp/verify.log 2>&1; echo "EXIT=$?"                      # unit + typecheck + lint + build
```

---

### Task 1: The single-key predicate and the label formatter

**Files:**
- Create: `src/lib/shortcut-keys.ts`
- Test: `tests/unit/shortcut-keys.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type KeyEventLike = { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean; repeat: boolean; keyCode?: number; target: EventTarget | { closest?: (selector: string) => unknown } | null }`
  - `isSingleKeyShortcut(event: KeyEventLike): boolean`
  - `shortcutLabel(shortcut: string): string` — `"E"` → `"E"`, `"Meta+I Control+I"` → `"⌘I"`, `"Meta+K Control+K /"` → `"⌘K"`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/shortcut-keys.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isSingleKeyShortcut, shortcutLabel, type KeyEventLike } from "@/lib/shortcut-keys";

/** A target whose closest() answers for the selectors it is "inside". */
function inside(...matches: string[]) {
  return { closest: (selector: string) => (matches.some((m) => selector.includes(m)) ? {} : null) };
}

function key(overrides: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    key: "c",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    repeat: false,
    target: inside(),
    ...overrides,
  };
}

describe("isSingleKeyShortcut", () => {
  it("accepts a plain letter or slash on the page", () => {
    expect(isSingleKeyShortcut(key({ key: "c" }))).toBe(true);
    expect(isSingleKeyShortcut(key({ key: "e" }))).toBe(true);
    expect(isSingleKeyShortcut(key({ key: "/" }))).toBe(true);
  });

  it("accepts Shift+/ because some layouts need Shift to type a slash", () => {
    expect(isSingleKeyShortcut(key({ key: "/", shiftKey: true }))).toBe(true);
  });

  it("refuses a letter with Shift", () => {
    expect(isSingleKeyShortcut(key({ key: "C", shiftKey: true }))).toBe(false);
  });

  it("refuses any modifier", () => {
    expect(isSingleKeyShortcut(key({ metaKey: true }))).toBe(false);
    expect(isSingleKeyShortcut(key({ ctrlKey: true }))).toBe(false);
    expect(isSingleKeyShortcut(key({ altKey: true }))).toBe(false);
  });

  it("refuses a key that is part of an input-method composition", () => {
    expect(isSingleKeyShortcut(key({ isComposing: true }))).toBe(false);
    expect(isSingleKeyShortcut(key({ keyCode: 229 }))).toBe(false);
  });

  it("refuses an auto-repeated key", () => {
    expect(isSingleKeyShortcut(key({ repeat: true }))).toBe(false);
  });

  it("refuses a key typed into something editable", () => {
    expect(isSingleKeyShortcut(key({ target: inside("input") }))).toBe(false);
    expect(isSingleKeyShortcut(key({ target: inside("textarea") }))).toBe(false);
    expect(isSingleKeyShortcut(key({ target: inside("select") }))).toBe(false);
    expect(isSingleKeyShortcut(key({ target: inside("[contenteditable]") }))).toBe(false);
  });

  it("refuses a key pressed inside a dialog, menu or listbox", () => {
    expect(isSingleKeyShortcut(key({ target: inside('[role="dialog"]') }))).toBe(false);
    expect(isSingleKeyShortcut(key({ target: inside('[role="menu"]') }))).toBe(false);
    expect(isSingleKeyShortcut(key({ target: inside('[role="listbox"]') }))).toBe(false);
  });

  it("treats a target without closest() (the window, the document) as the page", () => {
    expect(isSingleKeyShortcut(key({ target: null }))).toBe(true);
    expect(isSingleKeyShortcut(key({ target: {} }))).toBe(true);
  });
});

describe("shortcutLabel", () => {
  it("shows a single key as itself", () => {
    expect(shortcutLabel("E")).toBe("E");
    expect(shortcutLabel("C")).toBe("C");
  });

  it("shows the first alternative, with Meta as ⌘", () => {
    expect(shortcutLabel("Meta+I Control+I")).toBe("⌘I");
    expect(shortcutLabel("Meta+K Control+K /")).toBe("⌘K");
  });

  it("shows Control as Ctrl when it comes first", () => {
    expect(shortcutLabel("Control+I")).toBe("Ctrl I");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/vitest run --config vitest.config.ts tests/unit/shortcut-keys.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t1.log`
Expected: `EXIT=1`, failure resolving `@/lib/shortcut-keys`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/shortcut-keys.ts`:

```ts
/**
 * Whether a key press may act as a single-key shortcut (`C`, `E`, `/`), and
 * how a registry `shortcut` reads on screen.
 *
 * A single key is also a character, so the rule is mostly about when it is
 * *not* a shortcut: while someone is typing into a field, composing with an
 * input method (a Chinese reader typing a letter mid-composition), or working
 * inside a dialog or menu that owns its own keys. See the keyboard-shortcuts
 * design, §3.3.
 */

/** The parts of a KeyboardEvent this reads; a plain object in tests. */
export type KeyEventLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
  repeat: boolean;
  /** 229 is what an input method reports where `isComposing` is not set. */
  keyCode?: number;
  target: EventTarget | { closest?: (selector: string) => unknown } | null;
};

const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const OWNS_ITS_KEYS = '[role="dialog"], [role="menu"], [role="listbox"]';

export function isSingleKeyShortcut(event: KeyEventLike): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.isComposing || event.keyCode === 229) return false;
  if (event.repeat) return false;
  // `/` needs Shift on some layouts (Shift+7 in German); a letter never does.
  if (event.shiftKey && event.key !== "/") return false;
  const target = event.target as { closest?: (selector: string) => unknown } | null;
  if (typeof target?.closest === "function") {
    if (target.closest(EDITABLE) || target.closest(OWNS_ITS_KEYS)) return false;
  }
  return true;
}

/**
 * A registry `shortcut` is spelled for `aria-keyshortcuts` ("Meta+I Control+I").
 * On screen it shows its first alternative, the way the UI already writes ⌘K.
 */
export function shortcutLabel(shortcut: string): string {
  const [first = ""] = shortcut.split(" ");
  return first
    .split("+")
    .map((part) => (part === "Meta" ? "⌘" : part === "Control" ? "Ctrl " : part))
    .join("");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node_modules/.bin/vitest run --config vitest.config.ts tests/unit/shortcut-keys.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; tail -6 /tmp/t1.log`
Expected: `EXIT=0`, all tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shortcut-keys.ts tests/unit/shortcut-keys.test.ts
git commit -m "feat(ui): the rule for when a single key is a shortcut

Claude-Session: https://claude.ai/code/session_01G1pWCcBMKrXn91HSNQSodL"
```

---

### Task 2: Shortcuts on the registry

**Files:**
- Modify: `src/components/actions/action-registry.ts` (the `create.document` and `document.edit` entries)
- Test: `tests/unit/action-registry.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `create.document` carries `shortcut: "C"`; `document.edit` carries `shortcut: "E"`. Task 4 finds actions by `action.shortcut.toLowerCase() === event.key.toLowerCase()`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/action-registry.test.ts` (the file already defines `context()`, `target()` and imports `availableActions`):

```ts
describe("action registry — shortcuts", () => {
  const byId = (id: string, ctx: ActionContext) =>
    availableActions(ctx).find((action) => action.id === id);

  it("binds C to Add to Notes and E to Edit document", () => {
    expect(byId("create.document", context())?.shortcut).toBe("C");
    expect(byId("document.edit", context({ target: target() }))?.shortcut).toBe("E");
  });

  it("offers no E wherever editing is not offered", () => {
    const withE = (t: ActionTarget) =>
      availableActions(context({ target: t })).filter((action) => action.shortcut === "E");
    expect(withE(target({ ownership: "SOURCE_MANAGED" }))).toEqual([]);
    expect(withE(target({ status: "ARCHIVED" }))).toEqual([]);
    expect(withE(target({ revision: "HISTORICAL" }))).toEqual([]);
  });

  it("gives no two actions the same shortcut", () => {
    const shortcuts = availableActions(context({ target: target() }))
      .map((action) => action.shortcut)
      .filter((shortcut): shortcut is string => Boolean(shortcut));
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/vitest run --config vitest.config.ts tests/unit/action-registry.test.ts > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "✗|×|FAIL|expected" /tmp/t2.log | head`
Expected: `EXIT=1`; "binds C to Add to Notes…" fails (`expected undefined to be 'C'`).

- [ ] **Step 3: Write minimal implementation**

In `src/components/actions/action-registry.ts`, in the `create.document` entry, add the line after `keywords`:

```ts
      keywords: ["new", "note", "document", "write"],
      shortcut: "C",
```

In the `document.edit` entry, add the line after `keywords`:

```ts
        keywords: ["rename", "title", "write", target.label],
        shortcut: "E",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node_modules/.bin/vitest run --config vitest.config.ts tests/unit/action-registry.test.ts > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -6 /tmp/t2.log`
Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/components/actions/action-registry.ts tests/unit/action-registry.test.ts
git commit -m "feat(ui): C and E on the registry's create and edit actions

Claude-Session: https://claude.ai/code/session_01G1pWCcBMKrXn91HSNQSodL"
```

---

### Task 3: `Kbd`, and showing shortcuts in the palette and on tooltips

**Files:**
- Create: `src/components/ui/kbd.tsx`
- Modify: `src/components/search/quick-search.tsx` (the trigger button's `title` and `<kbd>`, and the action row)
- Modify: `src/components/knowledge/document-header.tsx` (the Edit link)
- Modify: `src/components/knowledge/source-sidebar.tsx:115` (`addNote`)
- Test: `tests/unit/ui-primitives.test.tsx`

**Interfaces:**
- Consumes: `shortcutLabel(shortcut: string): string` from Task 1; `action.shortcut` from Task 2.
- Produces: `Kbd({ children, className }: { children: ReactNode; className?: string })` renders `<kbd>` with `rounded-sm`.

- [ ] **Step 1: Write the failing test**

In `tests/unit/ui-primitives.test.tsx`, add to the imports:

```ts
import { Kbd } from "@/components/ui/kbd";
```

and append:

```ts
describe("Kbd", () => {
  it("renders a kbd on the inline-chrome radius, with the caller's classes after its own", () => {
    const html = renderToStaticMarkup(<Kbd className="ml-3">⌘K</Kbd>);
    expect(html).toMatch(/^<kbd class="[^"]*\brounded-sm\b[^"]*\bml-3"/);
    expect(html).toContain(">⌘K</kbd>");
    expect(html).not.toContain("rounded-md");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/vitest run --config vitest.config.ts tests/unit/ui-primitives.test.tsx > /tmp/t3.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/t3.log`
Expected: `EXIT=1`, cannot resolve `@/components/ui/kbd`.

- [ ] **Step 3: Create the primitive**

Create `src/components/ui/kbd.tsx`:

```tsx
import type { ReactNode } from "react";

/**
 * A key, as it is shown next to what it does. Inline chrome, so the `sm`
 * radius (contract §5); `text-faint`, because a hint is not content (§8).
 */
export function Kbd({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={`rounded-sm bg-kh-bg-subtle px-1 text-micro text-kh-text-faint ${className}`}>
      {children}
    </kbd>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node_modules/.bin/vitest run --config vitest.config.ts tests/unit/ui-primitives.test.tsx > /tmp/t3.log 2>&1; echo "EXIT=$?"; tail -6 /tmp/t3.log`
Expected: `EXIT=0`.

- [ ] **Step 5: Use it in QuickSearch**

In `src/components/search/quick-search.tsx`, add imports:

```ts
import { Kbd } from "@/components/ui/kbd";
import { shortcutLabel } from "@/lib/shortcut-keys";
```

Replace the trigger button's `title` and its `<kbd>`:

```tsx
        aria-label="Quick search"
        aria-keyshortcuts="Meta+K Control+K /"
        title="Quick search (⌘K or /)"
```

```tsx
        <Kbd className="ml-3 hidden lg:inline">⌘K</Kbd>
```

In the action row, after the label `<span>` (the one rendering `{action.label}`), add:

```tsx
                        {action.shortcut ? <Kbd className="shrink-0">{shortcutLabel(action.shortcut)}</Kbd> : null}
```

- [ ] **Step 6: Tooltips on the Edit and Add-to-Notes buttons**

In `src/components/knowledge/document-header.tsx`, the Edit `<a>`:

```tsx
              <a
                href={editHref}
                aria-label="Edit"
                aria-keyshortcuts="E"
                title="Edit (E)"
                className={buttonClasses({ variant: "ghost", icon: true })}
              >
```

In `src/components/knowledge/source-sidebar.tsx:115`, replace `title="Add to Notes"` with:

```tsx
aria-keyshortcuts="C" title="Add to Notes (C)"
```

(keep `aria-label="Add to Notes"` unchanged — e2e tests find the button by that name).

- [ ] **Step 7: Typecheck and lint**

Run: `make typecheck > /tmp/t3b.log 2>&1; echo "EXIT=$?"; make lint >> /tmp/t3b.log 2>&1; echo "EXIT=$?"`
Expected: both `EXIT=0`.

- [ ] **Step 8: Commit**

```bash
git add src/components/ui/kbd.tsx tests/unit/ui-primitives.test.tsx src/components/search/quick-search.tsx src/components/knowledge/document-header.tsx src/components/knowledge/source-sidebar.tsx
git commit -m "feat(ui): shortcuts shown in the palette and on their buttons' tooltips

Claude-Session: https://claude.ai/code/session_01G1pWCcBMKrXn91HSNQSodL"
```

---

### Task 4: Binding `/`, `C` and `E`

**Files:**
- Modify: `src/components/search/quick-search.tsx` (the `onShortcut` effect, currently lines ~107–120)
- Test: `tests/e2e/keyboard-shortcuts.spec.ts` (create)

**Interfaces:**
- Consumes: `isSingleKeyShortcut` (Task 1); `action.shortcut` (Task 2); the component's existing `actions`, `runAction`, `setOpen`, `enabled`.
- Produces: nothing new for later tasks. Task 5 appends to the same e2e file.

- [ ] **Step 1: Write the failing e2e tests**

Create `tests/e2e/keyboard-shortcuts.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS.
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const EMPTY_WORKSPACE = "0199f100-0000-7000-8000-000000000004";
const OBSIDIAN_SOURCE = "0199f100-0000-7000-8000-000000000101";
const SOURCE_MANAGED_SOURCE = "0199f100-0000-7000-8000-000000000105";
const SOURCE_MANAGED_DOCUMENT = "0199f100-0000-7000-8000-000000000210";
const ROUND_TRIP = { timeout: 15_000 };

/**
 * A key pressed before hydration reaches no listener. Press, and retry until
 * the page answers, rather than guessing how long hydration takes.
 */
async function pressUntil(page: Page, key: string, answered: () => Promise<void>) {
  await expect(async () => {
    await page.keyboard.press(key);
    await answered();
  }).toPass(ROUND_TRIP);
}

/** `/knowledge/:sourceId` redirects to a document; act once it has landed. */
async function openArchitecture(page: Page) {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}`);
  await page.getByRole("treeitem", { name: "Architecture", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Architecture" })).toBeVisible(ROUND_TRIP);
}

test("/ opens the palette without typing the slash, and the palette shows shortcuts", async ({ page }) => {
  await openArchitecture(page);
  const field = page.getByRole("combobox", { name: "Search documents and actions" });
  await pressUntil(page, "/", () => expect(field).toBeVisible({ timeout: 1_000 }));
  await expect(field).toHaveValue("");

  const list = page.getByRole("listbox", { name: "Actions and documents" });
  await expect(list.getByRole("option", { name: /Add to Notes/ }).locator("kbd")).toHaveText("C");
  await expect(list.getByRole("option", { name: /Edit document/ }).locator("kbd")).toHaveText("E");
});

test("C opens a new note", async ({ page }) => {
  await openArchitecture(page);
  await pressUntil(page, "c", () => expect(page).toHaveURL(/\/knowledge\/new$/, { timeout: 1_000 }));
});

test("a letter typed into a field stays in the field", async ({ page }) => {
  await openArchitecture(page);
  const before = page.url();
  await page.getByRole("button", { name: "Filter documents and sources" }).click();
  const filter = page.locator("#tree-filter");
  await filter.focus();
  await page.keyboard.press("c");
  await expect(filter).toHaveValue("c");
  expect(page.url()).toBe(before);
});

test("E edits the document being read", async ({ page }) => {
  await openArchitecture(page);
  await pressUntil(page, "e", () => expect(page).toHaveURL(/\/edit$/, { timeout: 1_000 }));
});

test("E does nothing on source-managed content", async ({ page }) => {
  const url = `/w/${QUERY_MASTER_WORKSPACE}/knowledge/${SOURCE_MANAGED_SOURCE}/${SOURCE_MANAGED_DOCUMENT}`;
  await page.goto(url);
  // Prove the shortcuts are live on this page before asserting that E is not.
  const field = page.getByRole("combobox", { name: "Search documents and actions" });
  await pressUntil(page, "/", () => expect(field).toBeVisible({ timeout: 1_000 }));
  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);

  await page.keyboard.press("e");
  await page.waitForTimeout(500);
  expect(new URL(page.url()).pathname).toBe(url);
});
```

(`EMPTY_WORKSPACE` is declared here for Task 5.)

- [ ] **Step 2: Run to verify they fail**

Run: `make db-up > /dev/null 2>&1; node_modules/.bin/tsx scripts/test/e2e.ts tests/e2e/keyboard-shortcuts.spec.ts > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "passed|failed|✘" /tmp/t4.log`
Expected: non-zero `EXIT`, 4 failed and 1 passed. "/ opens the palette…", "C opens a new note" and "E edits…" fail because nothing is bound yet; "E does nothing…" fails at its opening `/` step. "a letter typed into a field…" passes, and must keep passing.

- [ ] **Step 3: Implement the binding**

In `src/components/search/quick-search.tsx`, add the import:

```ts
import { isSingleKeyShortcut } from "@/lib/shortcut-keys";
```

Replace the existing shortcut effect:

```ts
  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      return;
    }
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [enabled]);
```

with:

```ts
  // ⌘K, and the single keys. The single keys read the same actions this
  // palette lists, so E exists exactly when "Edit document" is on offer here:
  // the registry's three availability axes are not restated.
  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      return;
    }
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (!isSingleKeyShortcut(event)) return;
      if (event.key === "/") {
        // Kept out of the field that is about to take focus.
        event.preventDefault();
        setOpen(true);
        return;
      }
      const key = event.key.toLowerCase();
      const action = actions.find((candidate) => candidate.shortcut?.toLowerCase() === key);
      if (!action) return;
      event.preventDefault();
      runAction(action);
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [enabled, actions, runAction]);
```

- [ ] **Step 4: Run to verify they pass**

Run: `node_modules/.bin/tsx scripts/test/e2e.ts tests/e2e/keyboard-shortcuts.spec.ts > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "passed|failed|✘" /tmp/t4.log`
Expected: `EXIT=0`, `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/components/search/quick-search.tsx tests/e2e/keyboard-shortcuts.spec.ts
git commit -m "feat(ui): / opens the palette, C adds a note, E edits the document being read

Claude-Session: https://claude.ai/code/session_01G1pWCcBMKrXn91HSNQSodL"
```

---

### Task 5: `⌘Enter` and `Esc` in the document forms

**Files:**
- Create: `src/components/knowledge/use-form-keys.ts`
- Modify: `src/components/knowledge/document-editor.tsx`
- Modify: `src/components/knowledge/new-document-form.tsx`
- Test: `tests/e2e/keyboard-shortcuts.spec.ts` (append)

**Interfaces:**
- Consumes: `pressUntil`, `EMPTY_WORKSPACE`, `ROUND_TRIP` from the spec file (Task 4).
- Produces: `useFormKeys({ dirty, busy, onCancel }: { dirty: boolean; busy: boolean; onCancel: () => void }): (event: React.KeyboardEvent<HTMLFormElement>) => void`

- [ ] **Step 1: Write the failing e2e tests**

Append to `tests/e2e/keyboard-shortcuts.spec.ts`:

```ts
/** A note of our own, so saving it cannot disturb another test's fixture. */
async function editOwnNote(page: Page, title: string) {
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  const field = page.getByLabel("Document title");
  await expect(field).toBeEditable(ROUND_TRIP);
  await field.fill(title);
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible(ROUND_TRIP);
  await pressUntil(page, "e", () => expect(page).toHaveURL(/\/edit$/, { timeout: 1_000 }));
  // main form + first(): the duplicate-DOM quirk phase5-authoring documents.
  const titleField = page.locator("main form").first().getByLabel("Title", { exact: true });
  await expect(titleField).toBeEditable(ROUND_TRIP);
  return titleField;
}

test("⌘Enter saves from inside the editor", async ({ page }) => {
  const titleField = await editOwnNote(page, "Shortcut Save Note");
  await titleField.fill("Saved By Keyboard");
  await titleField.press("ControlOrMeta+Enter");
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
  await expect(page.getByRole("heading", { name: "Saved By Keyboard" })).toBeVisible(ROUND_TRIP);
});

test("Esc leaves an unchanged editor", async ({ page }) => {
  const titleField = await editOwnNote(page, "Shortcut Esc Clean Note");
  await titleField.press("Escape");
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
  await expect(page.getByRole("heading", { name: "Shortcut Esc Clean Note" })).toBeVisible(ROUND_TRIP);
});

test("Esc never discards a changed draft", async ({ page }) => {
  const titleField = await editOwnNote(page, "Shortcut Esc Dirty Note");
  await titleField.fill("Unsaved change");
  await titleField.press("Escape");
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/edit$/);
  await expect(titleField).toHaveValue("Unsaved change");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node_modules/.bin/tsx scripts/test/e2e.ts tests/e2e/keyboard-shortcuts.spec.ts > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "passed|failed|✘" /tmp/t5.log`
Expected: non-zero `EXIT`; "⌘Enter saves…" and "Esc leaves…" fail. "Esc never discards…" passes already (nothing handles Esc yet); that is expected, and it must keep passing.

- [ ] **Step 3: Create the key handler**

Create `src/components/knowledge/use-form-keys.ts`:

```ts
"use client";

import type { KeyboardEvent } from "react";

/**
 * ⌘Enter / Ctrl+Enter saves and Esc cancels, inside a document form. Keyboard
 * shortcuts design §5.
 *
 * Saving goes through the form's own submit button and only when that button
 * is enabled: `requestSubmit()` ignores a disabled button, so checking it here
 * is what keeps "not hydrated yet", "saving", "access unconfirmed" and "no
 * title" (all already on the button) from being restated.
 *
 * Esc leaves only an unchanged form. With changes it does nothing, so no key
 * discards a draft; Cancel is the one way to.
 */
export function useFormKeys({ dirty, busy, onCancel }: { dirty: boolean; busy: boolean; onCancel: () => void }) {
  return (event: KeyboardEvent<HTMLFormElement>) => {
    // An input method uses Enter and Esc to finish or abandon a composition.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      const submit = event.currentTarget.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (!submit || submit.disabled) return;
      event.preventDefault();
      event.currentTarget.requestSubmit(submit);
      return;
    }
    if (event.key === "Escape" && !dirty && !busy) {
      event.preventDefault();
      onCancel();
    }
  };
}
```

- [ ] **Step 4: Wire the editor**

In `src/components/knowledge/document-editor.tsx`, add the import:

```ts
import { useFormKeys } from "@/components/knowledge/use-form-keys";
```

After `const documentHref = …`, add:

```ts
  const onKeyDown = useFormKeys({
    dirty: title !== initialTitle || markdown !== initialMarkdown,
    busy,
    onCancel: () => router.push(documentHref),
  });
```

On the `<form>`, add `onKeyDown={onKeyDown}`:

```tsx
    <form
      className="kh-reading-column space-y-4 py-6"
      onKeyDown={onKeyDown}
      onSubmit={(event) => { event.preventDefault(); void save(); }}
    >
```

Give the two buttons titles (their visible text, and so their accessible names, are unchanged):

```tsx
        <Button type="submit" title="Save (⌘Enter)" disabled={!ready || !confirmed || !title.trim()}>Save</Button>
        <Button type="button" variant="secondary" title="Cancel (Esc)" disabled={busy} onClick={() => router.push(documentHref)}>
```

- [ ] **Step 5: Wire the new-document form**

In `src/components/knowledge/new-document-form.tsx`, add the import:

```ts
import { useFormKeys } from "@/components/knowledge/use-form-keys";
```

The hook must run before the `if (!access.actions.canWrite) return null;` early return (rules of hooks). Directly after the `useState` declarations and before that line, add:

```ts
  // Cancel's own behaviour, shared with Esc. The confirm only fires when
  // something was typed, and Esc only cancels when nothing was, so Esc never
  // reaches it.
  function cancel() {
    if (variant === "empty") {
      if ((title || markdown) && !window.confirm("Discard this draft?")) return;
      router.push(`/w/${workspaceId}/knowledge`);
    } else {
      setOpen(false);
    }
  }
  const onKeyDown = useFormKeys({ dirty: Boolean(title || markdown), busy, onCancel: cancel });
```

On the `<form>`, add `onKeyDown={onKeyDown}`:

```tsx
        <form
          className="space-y-4"
          onKeyDown={onKeyDown}
          onSubmit={(event) => { event.preventDefault(); void create({ title, markdown }); }}
        >
```

Replace the two buttons with:

```tsx
            <Button type="submit" title="Create document (⌘Enter)" disabled={busy || !confirmed || !title.trim()}>{busy ? "Creating…" : "Create document"}</Button>
            <Button type="button" variant="secondary" title="Cancel (Esc)" disabled={busy} onClick={cancel}>Cancel</Button>
```

- [ ] **Step 6: Run to verify they pass**

Run: `node_modules/.bin/tsx scripts/test/e2e.ts tests/e2e/keyboard-shortcuts.spec.ts tests/e2e/phase5-authoring.spec.ts > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "passed|failed|✘" /tmp/t5.log`
Expected: `EXIT=0`; all keyboard-shortcuts tests and the existing authoring tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/knowledge/use-form-keys.ts src/components/knowledge/document-editor.tsx src/components/knowledge/new-document-form.tsx tests/e2e/keyboard-shortcuts.spec.ts
git commit -m "feat(ui): ⌘Enter saves and Esc leaves an unchanged document form

Claude-Session: https://claude.ai/code/session_01G1pWCcBMKrXn91HSNQSodL"
```

---

### Task 6: Record it in the contract, then verify everything

**Files:**
- Modify: `docs/superpowers/specs/frontend-design-language.md` (§10: a new `### Shortcuts` subsection inserted directly before the existing `### Menus` heading)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Amend §10**

Insert this block immediately before the line `### Menus` in `docs/superpowers/specs/frontend-design-language.md`:

```markdown
### Shortcuts

`Action.shortcut` in the registry is the one place a shortcut is defined. The
same value binds the key, is the `aria-keyshortcuts` on the button that does
the same thing, and is the hint shown beside the action in the palette
(`shortcutLabel`), so the three cannot disagree. Adding a shortcut is filling
that field.

A single key (`C`, `E`, `/`) is also a character, so it acts only when
`isSingleKeyShortcut` in `lib/shortcut-keys.ts` says so: no `⌘`, `Ctrl` or
`Alt`; not mid-composition in an input method (a letter typed while composing
Chinese is text, not a command); not inside a field, a dialog, a menu or a
listbox; not a key repeat; and no Shift, except for `/`, which some layouts
only type with it. Keys are compared by `event.key`, what the reader sees on
the keycap, not by position.

Single keys are bound in the palette (`quick-search.tsx`), from the same
actions it lists, so `E` exists exactly when "Edit document" is offered there:
on the document being read, when the registry's three availability axes allow
it. The row menu shows no hints. It acts on the row it was opened from, and a
row's "Edit document" beside an `E` that edits a different document would be
a lie on every row but one.

In the document forms, ⌘Enter saves through the form's own submit button, and
only when that button is enabled. `Esc` leaves only a form nothing has been
typed into; with changes it does nothing. No key discards a draft; Cancel is
the one way to.

```

- [ ] **Step 2: Full verification**

Run:

```bash
make verify > /tmp/verify.log 2>&1; echo "EXIT=$?"; grep -E "Tests  |Compiled|error" /tmp/verify.log | head
node_modules/.bin/tsx scripts/test/e2e.ts > /tmp/e2e.log 2>&1; echo "EXIT=$?"; grep -E "passed|failed|flaky|✘" /tmp/e2e.log
```

Expected: both `EXIT=0`; the unit count is the previous 411 plus the new cases; the e2e run reports no failures.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/frontend-design-language.md
git commit -m "docs(contract): §10 records how shortcuts are defined, when a single key acts, and Esc in forms

Claude-Session: https://claude.ai/code/session_01G1pWCcBMKrXn91HSNQSodL"
```
