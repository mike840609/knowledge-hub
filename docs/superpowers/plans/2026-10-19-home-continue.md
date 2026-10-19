# Personal Home "Continue" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the personal Home as one time-ordered Continue list, a Favorites list and an attention strip that appears only when something needs the user.

**Architecture:** A pure function `continueItems()` (in `src/lib/`) merges drafts, Hub-managed document edits and device-local recents into one list. A client component `HomeAttention` merges unread share comments with source reminders. `PersonalHome` lays out Attention → Continue → Favorites; the page stops querying folder updates.

**Tech Stack:** Next.js 15 App Router, React, Tailwind (replaced scales), Vitest (`renderToStaticMarkup`), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-19-home-continue-design.md`

## Global Constraints

- Read `docs/superpowers/specs/frontend-design-language.md` before touching `src/components` or `src/app`.
- Tailwind default spellings do not compile: use `text-body`, `text-caption`, `text-body-sm`, `rounded-md`; never `text-sm`, `text-xs`, `rounded`, `shadow-sm`.
- No new colour tokens. Accent is only `text-kh-selected-text` / `bg-kh-primary` / `kh-focus-ring`; warning status keeps `kh-warning-*`.
- Section labels: `text-caption font-medium text-kh-text-muted`. No cards, no shadows.
- Every list of rows keeps `onKeyDown={navigateListRows}` and `data-list-row` on its links.
- Region names, verbatim: `Needs attention`, `Continue`, `Favorites`. The unread comment list keeps `aria-label="Unread discussions"` (`tests/e2e/share-comment-notify.spec.ts` reads it).
- Continue cap: 8 rows. Event labels, verbatim: `Draft`, `Edited`, `Opened`.
- Empty copy, verbatim: `Documents you write, edit or open will appear here.` and `Star a document to keep it here.`
- `npm` is shadowed by an nvm function in non-interactive shells; run tests with `npx` as shown, and never pipe a test command (it hides the exit code).
- Commit messages end with `Claude-Session: https://claude.ai/code/session_018cJxuvCQCcgd3977sFpX8F`.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/lib/home-continue.ts` | create | `continueItems()` — merge, dedupe, order, cap. No I/O, no React. |
| `tests/unit/home-continue.test.ts` | create | Requirement tests for `continueItems()`. |
| `src/components/knowledge/home-attention.tsx` | create | `AttentionList` (presentational) + `HomeAttention` (fetches unread comments). |
| `tests/unit/home-attention.test.tsx` | create | Strip renders only with items; accent dot; warning status. |
| `src/components/knowledge/home-updates.tsx` | delete | Replaced by `home-attention.tsx` (folder change rows leave Home). |
| `src/components/knowledge/home-discussions.tsx` | delete | Folded into `home-attention.tsx`. |
| `src/components/knowledge/personal-home.tsx` | modify | New layout: Attention → Continue → Favorites. |
| `src/app/w/[workspaceId]/home/page.tsx` | modify | Pass `reminders` data; drop `folderUpdates.list`. |
| `tests/unit/personal-home-folder-sync.test.tsx` | modify | Assert new regions and copy. |
| `tests/e2e/{personal-profile,linear-remediation,folder-sync-reading-flow,personal-workspace,mvp-freshness}.spec.ts` | modify | New region names; no Drafts tab. |
| `src/components/help/user-guide-content.ts`, `src/components/help/user-guide-illustration.tsx` | modify | "Continue reading" → "Continue". |

---

### Task 1: `continueItems()`

**Files:**
- Create: `src/lib/home-continue.ts`
- Test: `tests/unit/home-continue.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ContinueDoc = { documentId: string; sourceId: string; title: string; updatedAt: string; ownership: "SOURCE_MANAGED" | "HUB_MANAGED"; status: "ACTIVE" | "ARCHIVED"; sourceStatus: "ACTIVE" | "ARCHIVED"; sourceName?: string; sourcePath?: string | null };
  export type ContinueDraft = { key: string; title: string; sourceId: string | null; updatedAt: string };
  export type ContinueItem = { id: string; label: "Draft" | "Edited" | "Opened"; at?: string; doc?: ContinueDoc; draft?: ContinueDraft };
  export const CONTINUE_LIMIT = 8;
  export function continueItems(input: { documents: readonly ContinueDoc[]; drafts: readonly ContinueDraft[]; recent: readonly string[]; openedAt?: Readonly<Record<string, string>> }): ContinueItem[];
  ```
  `id` is the document ID, or `"draft:new"` for the new-note draft. `recent` keys are `sourceId:documentId` (as `documentShortcutKey` builds them). A `Draft` item has `draft` set and, unless it is `draft:new`, `doc` too.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/home-continue.test.ts
import { describe, expect, it } from "vitest";
import { CONTINUE_LIMIT, continueItems, type ContinueDoc, type ContinueDraft } from "@/lib/home-continue";

const doc = (id: string, over: Partial<ContinueDoc> = {}): ContinueDoc => ({
  documentId: id, sourceId: "src", title: id, updatedAt: "2026-10-01T00:00:00.000Z",
  ownership: "HUB_MANAGED", status: "ACTIVE", sourceStatus: "ACTIVE", ...over,
});
const draft = (key: string, updatedAt: string): ContinueDraft => ({ key, title: key, sourceId: key === "draft:new" ? null : "src", updatedAt });
const ids = (items: { id: string; label: string }[]) => items.map(i => `${i.label}:${i.id}`);

describe("continueItems", () => {
  it("returns nothing for empty inputs", () => {
    expect(continueItems({ documents: [], drafts: [], recent: [] })).toEqual([]);
  });

  it("lists Hub-managed documents as Edited, newest first", () => {
    const documents = [doc("a", { updatedAt: "2026-10-01T00:00:00.000Z" }), doc("b", { updatedAt: "2026-10-03T00:00:00.000Z" })];
    expect(ids(continueItems({ documents, drafts: [], recent: [] }))).toEqual(["Edited:b", "Edited:a"]);
  });

  it("never lists a source-managed document as Edited, only as Opened", () => {
    const documents = [doc("s", { ownership: "SOURCE_MANAGED", updatedAt: "2026-10-09T00:00:00.000Z" })];
    expect(continueItems({ documents, drafts: [], recent: [] })).toEqual([]);
    const opened = continueItems({ documents, drafts: [], recent: ["src:s"], openedAt: { "src:s": "2026-10-02T00:00:00.000Z" } });
    expect(ids(opened)).toEqual(["Opened:s"]);
    expect(opened[0].at).toBe("2026-10-02T00:00:00.000Z");
  });

  it("keeps one row per document, labelled by its newest event", () => {
    const documents = [doc("a", { updatedAt: "2026-10-01T00:00:00.000Z" })];
    const items = continueItems({ documents, drafts: [], recent: ["src:a"], openedAt: { "src:a": "2026-10-05T00:00:00.000Z" } });
    expect(ids(items)).toEqual(["Opened:a"]);
  });

  it("lets a draft win over a newer edit or open of the same document", () => {
    const documents = [doc("a", { updatedAt: "2026-10-09T00:00:00.000Z" })];
    const items = continueItems({ documents, drafts: [draft("draft:a", "2026-10-01T00:00:00.000Z")], recent: ["src:a"], openedAt: { "src:a": "2026-10-08T00:00:00.000Z" } });
    expect(ids(items)).toEqual(["Draft:a"]);
    expect(items[0].doc?.documentId).toBe("a");
    expect(items[0].at).toBe("2026-10-01T00:00:00.000Z");
  });

  it("keeps the new-note draft, which has no document", () => {
    const items = continueItems({ documents: [], drafts: [draft("draft:new", "2026-10-01T00:00:00.000Z")], recent: [] });
    expect(ids(items)).toEqual(["Draft:draft:new"]);
    expect(items[0].doc).toBeUndefined();
  });

  it("excludes archived documents and documents in archived sources, whichever input names them", () => {
    const documents = [doc("a", { status: "ARCHIVED" }), doc("b", { sourceStatus: "ARCHIVED" })];
    const items = continueItems({ documents, drafts: [draft("draft:a", "2026-10-01T00:00:00.000Z")], recent: ["src:b"], openedAt: { "src:b": "2026-10-01T00:00:00.000Z" } });
    expect(items).toEqual([]);
  });

  it("excludes a draft or recent whose document is not in the workspace", () => {
    const items = continueItems({ documents: [], drafts: [draft("draft:gone", "2026-10-01T00:00:00.000Z")], recent: ["src:gone"], openedAt: { "src:gone": "2026-10-01T00:00:00.000Z" } });
    expect(items).toEqual([]);
  });

  it("puts recents without an open time after timed rows, in recents order", () => {
    const documents = [doc("x", { ownership: "SOURCE_MANAGED" }), doc("y", { ownership: "SOURCE_MANAGED" }), doc("e", { updatedAt: "2026-01-01T00:00:00.000Z" })];
    expect(ids(continueItems({ documents, drafts: [], recent: ["src:y", "src:x"] }))).toEqual(["Edited:e", "Opened:y", "Opened:x"]);
  });

  it(`caps the list at ${CONTINUE_LIMIT} rows`, () => {
    const documents = Array.from({ length: 12 }, (_, n) => doc(`d${n}`, { updatedAt: `2026-10-${String(n + 1).padStart(2, "0")}T00:00:00.000Z` }));
    const items = continueItems({ documents, drafts: [], recent: [] });
    expect(items).toHaveLength(CONTINUE_LIMIT);
    expect(items[0].id).toBe("d11");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/home-continue.test.ts`
Expected: FAIL — cannot resolve `@/lib/home-continue`.

- [ ] **Step 3: Implement**

```ts
// src/lib/home-continue.ts
export type ContinueDoc = { documentId: string; sourceId: string; title: string; updatedAt: string; ownership: "SOURCE_MANAGED" | "HUB_MANAGED"; status: "ACTIVE" | "ARCHIVED"; sourceStatus: "ACTIVE" | "ARCHIVED"; sourceName?: string; sourcePath?: string | null };
export type ContinueDraft = { key: string; title: string; sourceId: string | null; updatedAt: string };
export type ContinueItem = { id: string; label: "Draft" | "Edited" | "Opened"; at?: string; doc?: ContinueDoc; draft?: ContinueDraft };

export const CONTINUE_LIMIT = 8;

/** Rank two entries for the same document: a draft always wins, then the newer time; untimed loses. */
function beats(next: ContinueItem, held: ContinueItem): boolean {
  if (held.label === "Draft") return false;
  if (next.label === "Draft") return true;
  return !!next.at && (!held.at || next.at > held.at);
}

/**
 * Home's Continue list: drafts, the user's Hub-managed edits and this device's recents, one row
 * per document, newest first. A source-managed document's `updatedAt` is written by a sync, not
 * by the user, so it never counts as Edited.
 */
export function continueItems({ documents, drafts, recent, openedAt = {} }: {
  documents: readonly ContinueDoc[]; drafts: readonly ContinueDraft[]; recent: readonly string[]; openedAt?: Readonly<Record<string, string>>;
}): ContinueItem[] {
  const active = documents.filter(d => d.status === "ACTIVE" && d.sourceStatus === "ACTIVE");
  const byId = new Map(active.map(d => [d.documentId, d]));
  const byShortcut = new Map(active.map(d => [`${d.sourceId}:${d.documentId}`, d]));
  const held = new Map<string, ContinueItem>();
  const offer = (item: ContinueItem) => {
    const current = held.get(item.id);
    if (!current || beats(item, current)) held.set(item.id, item);
  };
  // Recents first: Map keeps first-insertion order, which is the order untimed recents keep.
  for (const key of recent) {
    const doc = byShortcut.get(key);
    if (doc) offer({ id: doc.documentId, label: "Opened", at: openedAt[key], doc });
  }
  for (const doc of active) if (doc.ownership === "HUB_MANAGED") offer({ id: doc.documentId, label: "Edited", at: doc.updatedAt, doc });
  for (const draft of drafts) {
    if (draft.key === "draft:new") { offer({ id: draft.key, label: "Draft", at: draft.updatedAt, draft }); continue; }
    const doc = byId.get(draft.key.slice("draft:".length));
    if (doc) offer({ id: doc.documentId, label: "Draft", at: draft.updatedAt, doc, draft });
  }
  return [...held.values()]
    .sort((a, b) => (a.at && b.at ? b.at.localeCompare(a.at) : a.at ? -1 : b.at ? 1 : 0))
    .slice(0, CONTINUE_LIMIT);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/home-continue.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/home-continue.ts tests/unit/home-continue.test.ts
git commit -m "feat(home): merge drafts, edits and recents into one Continue list

Claude-Session: https://claude.ai/code/session_018cJxuvCQCcgd3977sFpX8F"
```

---

### Task 2: Attention strip

**Files:**
- Create: `src/components/knowledge/home-attention.tsx`
- Test: `tests/unit/home-attention.test.tsx`

**Interfaces:**
- Consumes: `FreshnessReminder` from `@/modules/personal/application/knowledge-freshness` (type only); `ShareCommentNotificationView` from `@/modules/knowledge/domain/share-comment-event` (type only); `reviewRequest` from `./review-thread-list`.
- Produces:
  ```ts
  export function AttentionList(props: { workspaceId: string; reminders: readonly FreshnessReminder[]; notices: readonly ShareCommentNotificationView[] }): JSX.Element | null;
  export function HomeAttention(props: { workspaceId: string; reminders: readonly FreshnessReminder[] }): JSX.Element | null;
  ```

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/unit/home-attention.test.tsx
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AttentionList } from "@/components/knowledge/home-attention";
import type { FreshnessReminder } from "@/modules/personal/application/knowledge-freshness";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";

const reminder = (status: FreshnessReminder["status"], sourceId = "s1"): FreshnessReminder => ({ sourceId, sourceName: `Folder ${sourceId}`, status, previewId: status === "pending" ? "p1" : null, lastImportedAt: null });
const notice = { id: "n1", workspaceId: "ws", sourceId: "s", documentId: "d", threadId: "t1", documentTitle: "Plan", authorName: "Ana", excerpt: "Looks good", createdAt: "2026-10-18T00:00:00.000Z" } as unknown as ShareCommentNotificationView;
const render = (reminders: FreshnessReminder[], notices: ShareCommentNotificationView[]) =>
  renderToStaticMarkup(<AttentionList workspaceId="ws" reminders={reminders} notices={notices} />);

describe("AttentionList", () => {
  it("renders nothing when nothing needs the user", () => {
    expect(render([], [])).toBe("");
  });

  it("names the region and links to all updates when it has items", () => {
    const html = render([reminder("old")], []);
    expect(html).toContain('aria-label="Needs attention"');
    expect(html).toContain('href="/w/ws/updates"');
    expect(html).toContain("View all updates");
  });

  it("lists unread comments with an accent dot and a link to the thread", () => {
    const html = render([], [notice]);
    expect(html).toContain('aria-label="Unread discussions"');
    expect(html).toContain('href="/w/ws/knowledge/s/d?thread=t1"');
    expect(html).toContain("bg-kh-primary");
    expect(html).toContain("Ana: Looks good");
  });

  it("keeps a failed import in warning tokens, not the accent", () => {
    const html = render([reminder("failed")], []);
    expect(html).toContain("Import failed · Retry import");
    expect(html).toContain("text-kh-warning");
    expect(html).not.toContain("bg-kh-primary");
  });

  it("sends several reminders to the sources list", () => {
    const html = render([reminder("old", "a"), reminder("never", "b")], []);
    expect(html).toContain("2 sources need attention");
    expect(html).toContain('href="/w/ws/sources"');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/home-attention.test.tsx`
Expected: FAIL — cannot resolve `@/components/knowledge/home-attention`.

- [ ] **Step 3: Implement** (reminder logic and copy are moved verbatim from `HomeSourceAttention`; comment fetch from `HomeDiscussions`)

```tsx
// src/components/knowledge/home-attention.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";
import type { FreshnessReminder } from "@/modules/personal/application/knowledge-freshness";
import { Timestamp } from "@/components/ui/timestamp";
import { reviewRequest } from "./review-thread-list";

const ORDER = ["failed", "pending", "never", "old"];

function SourceReminder({ workspaceId, reminders }: { workspaceId: string; reminders: readonly FreshnessReminder[] }) {
  const first = [...reminders].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status))[0];
  const failed = reminders.some(item => item.status === "failed");
  const href = reminders.length > 1 ? `/w/${workspaceId}/sources` : first.previewId ? `/w/${workspaceId}/sources/imports/${first.previewId}` : `/w/${workspaceId}/sources/${first.sourceId}/update`;
  const message = reminders.length > 1 ? `${reminders.length} sources need attention${failed ? " · Import failed" : ""} · Review sources` : first.status === "failed" ? "Import failed · Retry import" : first.status === "pending" ? "Awaiting Apply · Review preview" : "Check for folder updates";
  return <Link className={`kh-interactive-row kh-focus-ring block rounded-md px-3 py-2 text-body-sm ${failed ? "text-kh-warning" : "text-kh-text"}`} href={href}>
    <span className="block font-medium">{message}</span>
    {reminders.length === 1 ? <span className="mt-1 block truncate text-caption text-kh-text-muted">{first.sourceName}</span> : null}
  </Link>;
}

/** What needs the user on Home: unread share comments and source reminders. Renders nothing otherwise. */
export function AttentionList({ workspaceId, reminders, notices }: { workspaceId: string; reminders: readonly FreshnessReminder[]; notices: readonly ShareCommentNotificationView[] }) {
  if (!reminders.length && !notices.length) return null;
  return <section aria-label="Needs attention" className="rounded-md border border-kh-border py-1">
    <div className="flex items-baseline justify-between px-3 pb-1 pt-2">
      <h2 className="text-caption font-medium text-kh-text-muted">Needs attention</h2>
      <Link className="kh-focus-ring rounded-md text-caption text-kh-link" href={`/w/${workspaceId}/updates`}>View all updates</Link>
    </div>
    {notices.length ? <ul aria-label="Unread discussions" className="space-y-0.5">{notices.slice(0, 5).map(notice => (
      <li key={notice.id}>
        <Link className="kh-interactive-row kh-focus-ring flex min-h-10 items-center gap-3 rounded-md px-3 py-1" href={`/w/${notice.workspaceId}/knowledge/${notice.sourceId}/${notice.documentId}?thread=${notice.threadId}`}>
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-kh-primary" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-medium text-kh-text">{notice.documentTitle}</span>
            <span className="block truncate text-caption text-kh-text-muted">{notice.authorName ?? "Someone"}: {notice.excerpt}</span>
          </span>
          <span className="shrink-0 text-caption text-kh-text-muted"><Timestamp value={String(notice.createdAt)} variant="relative" /></span>
        </Link>
      </li>
    ))}</ul> : null}
    {reminders.length ? <SourceReminder workspaceId={workspaceId} reminders={reminders} /> : null}
  </section>;
}

/** Fetches unread comments after mount; a failed fetch shows reminders only and never blocks Home. */
export function HomeAttention({ workspaceId, reminders }: { workspaceId: string; reminders: readonly FreshnessReminder[] }) {
  const [notices, setNotices] = useState<ShareCommentNotificationView[]>([]);
  useEffect(() => {
    let live = true;
    reviewRequest<{ notifications: ShareCommentNotificationView[] }>("/api/review-notifications/unread")
      .then(result => { if (live) setNotices(result.notifications); })
      .catch(() => { if (live) setNotices([]); });
    return () => { live = false; };
  }, []);
  return <AttentionList workspaceId={workspaceId} reminders={reminders} notices={notices} />;
}
```

Before relying on them, confirm `size-1.5` (spacing `1.5` is on the contract's half-step scale) and `text-kh-link` / `text-kh-warning` exist: `grep -n "kh-link\|kh-warning" tailwind.config.ts`. If `size-*` does not compile, use `h-1.5 w-1.5`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/home-attention.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/knowledge/home-attention.tsx tests/unit/home-attention.test.tsx
git commit -m "feat(home): one attention strip for unread comments and source reminders

Claude-Session: https://claude.ai/code/session_018cJxuvCQCcgd3977sFpX8F"
```

---

### Task 3: New Home layout

**Files:**
- Modify: `src/components/knowledge/personal-home.tsx`
- Modify: `src/app/w/[workspaceId]/home/page.tsx`
- Delete: `src/components/knowledge/home-updates.tsx`, `src/components/knowledge/home-discussions.tsx`
- Test: `tests/unit/personal-home-folder-sync.test.tsx`

**Interfaces:**
- Consumes: `continueItems`, `ContinueDoc`, `ContinueDraft`, `ContinueItem` (Task 1); `HomeAttention` (Task 2).
- Produces: `PersonalHome` props become
  `{ workspaceId: string; documents: ContinueDoc[]; drafts: ContinueDraft[]; reminders?: FreshnessReminder[]; slots?: { guidance?: ReactNode }; guidanceDismissed?: boolean }`
  (`updates` and `slots.reminders` are removed).

- [ ] **Step 1: Rewrite the unit test to the new requirements**

Replace the first `it(...)` in `tests/unit/personal-home-folder-sync.test.tsx` and make the shortcuts mock configurable. Keep the second test (`offers inline guide recovery…`) unchanged. Full new top of file:

```tsx
import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonalHome } from "@/components/knowledge/personal-home";
const shortcuts = vi.hoisted(() => ({ value: { favorites: [] as string[], recent: [] as string[] } as { favorites: string[]; recent: string[]; openedAt?: Record<string, string> } }));
vi.mock("@/components/knowledge/use-document-shortcuts", () => ({
  useDocumentShortcuts: () => ({ shortcuts: shortcuts.value, update: () => {} }),
  documentShortcutKey: (a: string, b: string) => `${a}:${b}`,
}));
// … keep the existing mocks for use-workspace-authorization, action-menu, next/navigation, toast, share-link-dialog …
beforeEach(() => { shortcuts.value = { favorites: [], recent: [] }; });

const doc = (id: string, over = {}) => ({ sourceId: "src", documentId: id, title: `Doc ${id}`, ownership: "HUB_MANAGED" as const, status: "ACTIVE" as const, sourceStatus: "ACTIVE" as const, updatedAt: "2026-10-09T00:00:00.000Z", ...over });

it("leads with Continue and Favorites, leaves search to ⌘K and the change feed to /updates", () => {
  const html = renderToStaticMarkup(<PersonalHome workspaceId="ws" documents={[]} drafts={[]} />);
  expect(html).not.toContain('role="search"');
  expect(html).not.toContain("/sources/import");
  expect(html).toContain("New note");
  expect(html).toContain('aria-label="Continue"');
  expect(html).toContain('aria-label="Favorites"');
  expect(html.indexOf('aria-label="Continue"')).toBeLessThan(html.indexOf('aria-label="Favorites"'));
  expect(html).not.toContain('aria-label="Updates"');
  expect(html).not.toContain('role="tablist"');
  expect(html).not.toContain("Needs attention");
  expect(html).toContain("Browse knowledge");
  expect(html).toContain("Documents you write, edit or open will appear here.");
  expect(html).toContain("Star a document to keep it here.");
});

it("marks a draft with the accent and edits in muted text", () => {
  const html = renderToStaticMarkup(<PersonalHome workspaceId="ws" documents={[doc("a"), doc("b", { updatedAt: "2026-10-01T00:00:00.000Z" })]} drafts={[{ key: "draft:a", title: "Doc a", sourceId: "src", updatedAt: "2026-10-02T00:00:00.000Z" }]} />);
  expect(html).toContain('href="/w/ws/knowledge/src/a/edit"');
  expect(html).toContain('href="/w/ws/knowledge/src/b"');
  expect(html).toMatch(/text-kh-selected-text[^"]*">Draft/);
  expect(html).toMatch(/text-kh-text-muted[^"]*">Edited/);
});

it("lists favourites in favourites order with a filled star", () => {
  shortcuts.value = { favorites: ["src:b", "src:a"], recent: [] };
  const html = renderToStaticMarkup(<PersonalHome workspaceId="ws" documents={[doc("a", { ownership: "SOURCE_MANAGED" }), doc("b", { ownership: "SOURCE_MANAGED" })]} drafts={[]} />);
  const favorites = html.slice(html.indexOf('aria-label="Favorites"'));
  expect(favorites.indexOf("Doc b")).toBeLessThan(favorites.indexOf("Doc a"));
  expect(favorites).toContain("Remove favorite: Doc b");
  expect(favorites).not.toContain("Star a document to keep it here.");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/personal-home-folder-sync.test.tsx`
Expected: FAIL — no `aria-label="Continue"` region.

- [ ] **Step 3: Rewrite `personal-home.tsx`**

Keep `Row` and the imports it needs. Replace `Section`, the `Doc`/`Draft` types, and `PersonalHome`'s body. Remove the imports of `HomeUpdates`, `HomeDiscussions`, `FolderUpdatesPage` and the Tabs components. Changes:

```tsx
import { continueItems, type ContinueDoc, type ContinueDraft, type ContinueItem } from "@/lib/home-continue";
import { HomeAttention } from "./home-attention";
import type { FreshnessReminder } from "@/modules/personal/application/knowledge-freshness";

type Doc = ContinueDoc;

/** A labelled group of rows; the label is the rail's group-label style, not a heading-size title. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0">
      <h2 className="px-3 pb-2 text-caption font-medium text-kh-text-muted">{title}</h2>
      {children}
    </section>
  );
}
```

Extend `Row` with an optional `eventLabel` rendered before the timestamp, so the label carries the accent independently of the time:

```tsx
// Row props: add `eventLabel?: { text: string; accent: boolean }` and replace both `{timeLabel} <Timestamp …/>` spans' leading text with:
<span className={eventLabel?.accent ? "text-kh-selected-text" : "text-kh-text-muted"}>{eventLabel?.text ?? timeLabel}</span>{" "}
```

`PersonalHome` (signature and body; `documentRows` becomes `documentRow(doc, extra)` returning one `Row`, keeping the existing actions, favourite star and `provenance`):

```tsx
export function PersonalHome({ workspaceId, documents, drafts, reminders = [], slots, guidanceDismissed = false }: { guidanceDismissed?: boolean; slots?: { guidance?: ReactNode }; workspaceId: string; documents: Doc[]; drafts: ContinueDraft[]; reminders?: FreshnessReminder[] }) {
  // … existing state: dismissed, shortcuts/update, hydrated, access/confirmed, runAction, keyOf …
  const items = continueItems({ documents, drafts, recent: shortcuts.recent, openedAt: shortcuts.openedAt });
  const favorites = shortcuts.favorites
    .map(key => documents.find(doc => keyOf(doc) === key))
    .filter((doc): doc is Doc => !!doc && doc.status === "ACTIVE" && doc.sourceStatus === "ACTIVE");
  // ponytail: every favourite is listed; add the rail's "show all" cut-off if lists grow past a screen.

  function continueRow(item: ContinueItem) {
    const eventLabel = { text: item.label, accent: item.label === "Draft" };
    if (item.label === "Draft") {
      const href = item.doc ? `/w/${workspaceId}/knowledge/${item.doc.sourceId}/${item.doc.documentId}/edit` : `/w/${workspaceId}/knowledge/new`;
      return <Row key={item.id} href={href} icon={<PenLine size={14} aria-hidden="true" />} title={item.draft?.title || "Untitled draft"} provenance="Continue writing" timestamp={item.at} eventLabel={eventLabel} />;
    }
    return documentRow(item.doc!, { timestamp: item.at, eventLabel });
  }

  return (
    <GuidanceVisibilityContext.Provider value={{ dismissed, setDismissed }}>
    <div className="kh-page space-y-6 pb-6">
      {/* PageHeader unchanged */}
      {slots?.guidance}
      <HomeAttention workspaceId={workspaceId} reminders={reminders} />
      <div className="-mx-3 space-y-6">
        <Section title="Continue">
          {items.length ? <ul onKeyDown={navigateListRows} className="space-y-0.5">{items.map(continueRow)}</ul>
            : <EmptyLine>Documents you write, edit or open will appear here.{documents.length === 0 && dismissed ? <ReopenGuidanceMenuItem workspaceId={workspaceId} surface="empty" /> : null}</EmptyLine>}
        </Section>
        <Section title="Favorites">
          {favorites.length ? <ul onKeyDown={navigateListRows} className="space-y-0.5">{favorites.map(doc => documentRow(doc, {}))}</ul>
            : <EmptyLine>Star a document to keep it here.</EmptyLine>}
        </Section>
        <Link className="kh-focus-ring inline-block rounded-md px-3 py-2 text-body-sm text-kh-link" href={`/w/${workspaceId}/knowledge`}>Browse knowledge</Link>
      </div>
      <ShareLinkDialogHost />
    </div>
    </GuidanceVisibilityContext.Provider>
  );
}
```

`documentRow(doc, { timestamp, eventLabel })` is the body of today's `documentRows` map callback, with `timestamp={timestamp}` and `eventLabel={eventLabel}` replacing `timestamp={shortcuts.openedAt?.[key]} timeLabel="Opened"`. The `Row` `key` stays `keyOf(doc)`.

- [ ] **Step 4: Update the page**

In `src/app/w/[workspaceId]/home/page.tsx`:
- Remove the `HomeSourceAttention` import and the `slots.reminders = …` line; change `slots` to `{ guidance?: ReactNode }`.
- Remove the `const updates = await s.folderUpdates.list(…)` line.
- Compute `const reminders = knowledgeFreshness(folderModel?.items ?? [], freshnessThreshold(freshness.value), new Date());`
- Render `<PersonalHome guidanceDismissed={onboarding.value.dismissed} slots={slots} workspaceId={workspaceId} documents={…unchanged…} drafts={drafts} reminders={reminders} />`.

Then delete the two replaced components:

```bash
git rm src/components/knowledge/home-updates.tsx src/components/knowledge/home-discussions.tsx
```

- [ ] **Step 5: Run unit tests, typecheck and lint**

Run: `npx vitest run --config vitest.config.ts tests/unit/personal-home-folder-sync.test.tsx tests/unit/home-continue.test.ts tests/unit/home-attention.test.tsx`
Expected: PASS.
Run: `make typecheck && make lint`
Expected: both exit 0 (no stale imports of the deleted files).

- [ ] **Step 6: Commit**

```bash
git add -A src/components/knowledge src/app/w/\[workspaceId\]/home/page.tsx tests/unit/personal-home-folder-sync.test.tsx
git commit -m "feat(home): Continue and Favorites replace the reading tabs and updates column

Claude-Session: https://claude.ai/code/session_018cJxuvCQCcgd3977sFpX8F"
```

---

### Task 4: E2E and help copy

**Files:**
- Modify: `tests/e2e/personal-profile.spec.ts:63`, `tests/e2e/linear-remediation.spec.ts:142,151`, `tests/e2e/folder-sync-reading-flow.spec.ts:22-23`, `tests/e2e/personal-workspace.spec.ts:66-67`, `tests/e2e/mvp-freshness.spec.ts:60`
- Modify: `src/components/help/user-guide-content.ts:64,68,148,152`, `src/components/help/user-guide-illustration.tsx:47`

- [ ] **Step 1: Update e2e selectors**

- `personal-profile.spec.ts:63` and `linear-remediation.spec.ts:151`: `{ name: "Continue reading" }` → `{ name: "Continue", exact: true }`. Line 142 comment: "Continue lists visited articles, so open this test's document first."
- `folder-sync-reading-flow.spec.ts:22-23`:
  ```ts
  await expect(page.getByRole("region", {name:"Continue", exact:true})).toBeVisible();
  await expect(page.getByRole("region", {name:"Updates"})).toHaveCount(0);
  ```
- `personal-workspace.spec.ts:66-67`: drop the tab click; the draft is in Continue:
  ```ts
  const draft = next.getByRole("region", { name: "Continue", exact: true })
    .getByRole("link").filter({ has: next.getByText("New persistent note", { exact: true }) });
  ```
- `mvp-freshness.spec.ts:60`: `{name:"Updates"}` → `{name:"Needs attention"}`.

- [ ] **Step 2: Update help copy**

- `user-guide-content.ts:64`: `"點星號收藏；回 Home 的 Continue 繼續閱讀或寫作。"`
- `:68`: `"收藏保存到帳號；Continue 裡的草稿與編輯跨裝置同步，最近開啟保存在裝置，換瀏覽器可能不同。"`
- `:148`: `"Star an article to save a favorite; return to Continue on Home to resume."`
- `:152`: `"Favorites are saved to your account. Drafts and edits in Continue follow your account; recently opened articles are stored on this device and may differ in another browser."`
- `user-guide-illustration.tsx:47` note: `t("Favorites are saved to your account. Recently opened is stored on this device.","收藏保存在帳號；最近開啟保存在目前裝置。")`

Run: `grep -rn "Continue reading" src tests`
Expected: no output.

- [ ] **Step 3: Run the affected e2e specs**

Run: `make db-up && npx tsx scripts/test/e2e.ts tests/e2e/personal-profile.spec.ts tests/e2e/linear-remediation.spec.ts tests/e2e/folder-sync-reading-flow.spec.ts tests/e2e/personal-workspace.spec.ts tests/e2e/mvp-freshness.spec.ts tests/e2e/share-comment-notify.spec.ts`
Expected: all pass. If documents hang on "Loading document" with `PROBE-NEXT` console lines, move `.next/cache` aside and rerun (stale build cache, not this change).

- [ ] **Step 4: Full local gate**

Run: `make verify`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e src/components/help
git commit -m "test(home): e2e and help copy follow the Continue layout

Claude-Session: https://claude.ai/code/session_018cJxuvCQCcgd3977sFpX8F"
```
