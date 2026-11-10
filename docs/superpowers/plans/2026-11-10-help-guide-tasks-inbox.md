# User guide Tasks + Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bilingual Inbox and Tasks chapters, with generated light/dark screenshots, to the shared `/help` user guide.

**Architecture:** Content, diagrams and screens are data in three `src/components/help/*` files rendered by `src/app/help/page.tsx`; the page reads `TASK_SEARCH_READ_ENABLED` and omits the search material when the flag is off. Screens are produced by the existing Playwright capture spec, not drawn or hand-edited.

**Tech Stack:** Next.js 15 (server components), TypeScript, Playwright, Vitest, `next/image`.

**Spec:** `docs/superpowers/specs/2026-11-10-help-guide-tasks-inbox-design.md`

## Global Constraints

- The guide is one shared address, `/help?lang=en|zh-TW`; every product link is built from `helpWorkspaceId()` as `/w/<id>/...`, never a literal workspace id.
- Section order is exactly `quick-start`, `sync`, `troubleshooting`, `reading`, `inbox`, `insights`, `tasks`, `sharing-export`.
- `TASK_SEARCH_READ_ENABLED === "true"` is the only condition for showing the Tasks search copy and the `tasks-search` screen; any other value hides both.
- Bilingual copy: English and Traditional Chinese prose; actual interface labels stay English in both.
- Screens: cropped regions at 2x, framed as a window with a neutral title bar, outlined controls in `--kh-focus`, numbered marks in caption order, one light and one dark image per shot.
- Do not rewrite the seven existing screens. `KM_GUIDE_ONLY` scopes a capture run to the new shots.
- No product route, permission or behaviour changes. This is guide content, capture tooling and tests only.

## Review Focus

- A reader in a flag-off deployment must never see a search field, a search bullet or a search screen: content unit test with `taskSearch:false`, and the E2E guide test on the flag-off server.
- A reader in a flag-on deployment must see the search material: content unit test with `taskSearch:true`.
- Every new chapter link must land in the reader's own My Space: E2E asserts `/w/<id>/inbox`, `/w/<id>/tasks`, `/w/<id>/tasks/setup`.
- No committed screenshot may contain the one-time setup line or a token: the capture asserts the line is absent before shooting `tasks-setup`, and the image is reviewed once.
- Adding two chapters must not break chapter navigation, anchor focus or the existing chapters: the existing E2E assertions still run against the new order.

---

### Task 1: Bilingual chapters and diagrams

**Files:**
- Modify: `src/components/help/user-guide-content.ts`
- Modify: `src/components/help/user-guide-illustration.tsx`
- Create: `tests/unit/user-guide-content.test.ts`

**Interfaces:**
- Consumes: `GuideContent`, `GuideLocale`, `GuideSection` from `@/components/imports/import-guide-content`.
- Produces:
  - `userGuideContent(locale: GuideLocale, options?: {taskSearch?: boolean}): UserGuideContent` (default `taskSearch: false`; existing one-argument calls keep working).
  - `UserGuideAction` union gains `"inbox" | "tasks" | "taskSetup"`.
  - `UserGuideIllustration` answers `sectionId: "inbox"` and `"tasks"`.

- [ ] **Step 1: Write the failing content test**

```ts
// tests/unit/user-guide-content.test.ts
import { describe, expect, it } from "vitest";
import { userGuideContent } from "@/components/help/user-guide-content";

const ids = (locale: "en" | "zh-TW", taskSearch: boolean) =>
  userGuideContent(locale, { taskSearch }).sections.map((section) => section.id);
const text = (locale: "en" | "zh-TW", taskSearch: boolean) =>
  JSON.stringify(userGuideContent(locale, { taskSearch }));
const ORDER = ["quick-start", "sync", "troubleshooting", "reading", "inbox", "insights", "tasks", "sharing-export"];

describe("user guide content", () => {
  it("places Inbox after reading and Tasks after Insights", () => {
    expect(ids("en", false)).toEqual(ORDER);
    expect(ids("zh-TW", true)).toEqual(ORDER);
  });

  it("only describes Task Search when the deployment enables it", () => {
    expect(text("en", false)).not.toContain("Search title, summary and findings");
    expect(text("en", true)).toContain("Search title, summary and findings");
    expect(text("zh-TW", false)).not.toContain("搜尋標題、摘要與 findings");
    expect(text("zh-TW", true)).toContain("搜尋標題、摘要與 findings");
  });

  it("links the new chapters into My Space", () => {
    for (const locale of ["en", "zh-TW"] as const) {
      expect(text(locale, false)).toContain('"target":"inbox"');
      expect(text(locale, false)).toContain('"target":"tasks"');
      expect(text(locale, false)).toContain('"target":"taskSetup"');
    }
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/user-guide-content.test.ts`
Expected: FAIL — the returned section ids lack `inbox` and `tasks`, and the search text is absent in both flag states.

- [ ] **Step 3: Extend the content model and add both sections**

In `src/components/help/user-guide-content.ts`:

- Change the action union to
  `export type UserGuideAction = {target:"sample"|"sources"|"identity"|"inbox"|"tasks"|"taskSetup";label:string};`
- Give `userGuideContent` the signature
  `export function userGuideContent(locale:GuideLocale,options:{taskSearch?:boolean}={}):UserGuideContent`,
  destructure `const taskSearch=options.taskSearch===true;`, and place the new sections between `reading` and `insights`, and between `insights` and `sharing-export`.

Insert the **inbox** section (`id:"inbox"`) with:

- en title `Inbox: discussions, mentions and shares`; zh-TW title `收件匣：討論、提及與分享`.
- Bullets covering, in this order: the three sources (your documents, followed discussions, mentions); relationship filters `All / My documents / Following / Mentions` plus `Status` (`Any / Open / Resolved`) and `Unread`; selecting a row to read the thread beside the list and `Reply` / `Resolve`, with `Open document` for the article, and the plain-list behaviour below the split width; `Mark read`, `Mark all read`, `Refresh`; `Proposals` and `Shared with you`, noting the latter also lives in Shares.
- Three `details` blocks:
  - `Read, resolve and unread` — opening marks read; a later reply can make it unread again; the sidebar badge counts unread discussions; resolving is separate.
  - `Dead links and permissions` — a revoked or expired link reads as unavailable and opens nothing; replying to a followed discussion needs a valid link, a signed-in identity and enabled comment writes; the Inbox grants no access.
  - `Inbox and Shares` — Inbox is the discussion index and notices; Shares manages your own links, expiry/revocation, saved shares and followed discussions.
- `links:[{target:"inbox",label:"Open Inbox"}]` (zh-TW: `開啟 Inbox`).

Insert the **tasks** section (`id:"tasks"`) with:

- en title `Tasks: results from coding agents`; zh-TW title `Tasks：代理完成的任務`.
- Bullets covering, in this order: finish in Claude Code or OpenCode, run `/hub-export`, open Tasks; first use (`Set up export` → create a binding → copy the one-time line and run it on your machine; one binding per machine; token shown once); `Active / Archived` list rows showing agent, revision and completion time and opening the detail that names the binding; detail sections `Summary`, `Verification`, `Findings / Decisions / Changes`, `References`, `Revisions`, with Verification described as agent-reported, not Hub-certified.
- One extra bullet only when `taskSearch` is true: the search row also shows the verification badge and a matched excerpt.
- Two `details` blocks:
  - `References and revisions` — Wiki path/document id resolves inside your My Space; `not found` and `ambiguous`; file/commit/PR labels and https-only PR links; re-exporting the same task creates a revision and old revisions stay readable; only completed tasks export.
  - `Token, binding and revocation` — one binding per machine; the setup line carries the token and is shown once, treat it as a secret; `Rotate token` invalidates the old token at once; `Revoke` stops exports and saved results remain; results are visible only in your own My Space.
- One extra `details` block only when `taskSearch` is true, titled `Search and filters`, starting with the exact sentence `Search title, summary and findings` (zh-TW must start with `搜尋標題、摘要與 findings`), covering Agent, Verification, Completed dates, removable chips, Clear all, URL-kept criteria and the browser's UTC offset.
- `links:[{target:"tasks",label:"Open Tasks"},{target:"taskSetup",label:"Set up export"}]` (zh-TW: `開啟 Tasks`, `設定 Task export`).

Copy for the Chinese version may be composed fresh, but it must state the same facts and keep every button/label name in English.

- [ ] **Step 4: Add the two diagrams**

In `src/components/help/user-guide-illustration.tsx`, add cases before `default`:

- `case "inbox"`: title `Diagram · One index, three relationships` / `示意圖 · 一個索引，三種關係`. Show three relationship columns (`My documents`, `Following`, `Mentions`) feeding one list, then two distinct outcomes (`Read` and `Resolve`) with a `Mark read` note. Footer: opening marks read, resolving is separate, and a dead link opens nothing.
- `case "tasks"`: title `Diagram · From a finished task to My Space` / `示意圖 · 從完成的任務到 My Space`. Use the existing `Flow` with steps `Finish in the agent` → `/hub-export` → `CLI uploads` → `Tasks detail`. Footer: results stay in your My Space and Verification is agent-reported.

Use the shared flat `Figure` wrapper, existing tokens and Lucide icons only; no framed window.

- [ ] **Step 5: Run the unit test and typecheck**

Run: `npx vitest run --config vitest.config.ts tests/unit/user-guide-content.test.ts`
Expected: PASS (3 tests).

Run: `npm run typecheck`
Expected: no errors (the two new illustration cases may need icon imports).

- [ ] **Step 6: Commit**

```bash
git add src/components/help/user-guide-content.ts src/components/help/user-guide-illustration.tsx tests/unit/user-guide-content.test.ts
git commit -m "feat(help): add Tasks and Inbox chapters and diagrams"
```

---

### Task 2: Flag helper, page wiring and chapter navigation

**Files:**
- Create: `src/server/help-config.ts`
- Modify: `src/app/help/page.tsx`
- Modify: `src/components/help/user-guide-navigation.tsx`
- Modify: `src/components/help/user-guide-screenshot.tsx` (signature and shot filter only)
- Create: `tests/unit/help-task-search-enabled.test.ts`

**Interfaces:**
- Produces: `helpTaskSearchEnabled(): boolean` from `src/server/help-config.ts`, true only for the exact string `"true"`.
- Produces: `UserGuideScreenshots({sectionId,locale,taskSearch=false}:{sectionId:string;locale:GuideLocale;taskSearch?:boolean})`.
- Consumes: `userGuideContent` from Task 1.

- [ ] **Step 1: Write the failing helper test**

```ts
// tests/unit/help-task-search-enabled.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { helpTaskSearchEnabled } from "@/server/help-config";

describe("helpTaskSearchEnabled", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("is true only for the exact flag value", () => {
    vi.stubEnv("TASK_SEARCH_READ_ENABLED", "true");
    expect(helpTaskSearchEnabled()).toBe(true);
    for (const value of ["false", "1", "TRUE", ""]) {
      vi.stubEnv("TASK_SEARCH_READ_ENABLED", value);
      expect(helpTaskSearchEnabled()).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/help-task-search-enabled.test.ts`
Expected: FAIL — `src/server/help-config.ts` does not exist.

- [ ] **Step 3: Add the helper**

```ts
// src/server/help-config.ts
/** The guide follows the deployment's Task Search reader; default-off is the product default. */
export function helpTaskSearchEnabled(): boolean {
  return process.env.TASK_SEARCH_READ_ENABLED === "true";
}
```

- [ ] **Step 4: Wire the page**

In `src/app/help/page.tsx`:

- Import `helpTaskSearchEnabled`.
- Compute `const taskSearch=helpTaskSearchEnabled();` before content, and call `userGuideContent(locale,{taskSearch})`.
- Add destinations to `GuideActionLinks`:
  `inbox:\`${base}/inbox\``, `tasks:\`${base}/tasks\``, `taskSetup:\`${base}/tasks/setup\``.
- Pass `taskSearch` to `<UserGuideScreenshots sectionId={s.id} locale={locale} taskSearch={taskSearch}/>`.

- [ ] **Step 5: Add the shot filter and short navigation labels**

In `src/components/help/user-guide-screenshot.tsx`:

- Add `only?: "taskSearch" | "noTaskSearch"` to `Shot`.
- Accept `taskSearch=false` and filter each section's shots:
  `(SHOTS[sectionId]??[]).filter(shot=>shot.only!=="taskSearch"||taskSearch).filter(shot=>shot.only!=="noTaskSearch"||!taskSearch)`.
  No new `SHOTS` entries yet; Task 4 adds them.

In `src/components/help/user-guide-navigation.tsx`, add to both label maps:
`inbox:"Inbox"`, `tasks:"Tasks"` (English) and `inbox:"收件匣"`, `tasks:"Tasks"` (zh-TW).

- [ ] **Step 6: Run the helper test, typecheck and lint**

Run: `npx vitest run --config vitest.config.ts tests/unit/help-task-search-enabled.test.ts`
Expected: PASS.

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/server/help-config.ts src/app/help/page.tsx src/components/help/user-guide-navigation.tsx src/components/help/user-guide-screenshot.tsx tests/unit/help-task-search-enabled.test.ts
git commit -m "feat(help): follow the Task Search flag and link the new chapters"
```

---

### Task 3: Capture the Inbox and Tasks screens

**Files:**
- Modify: `tests/e2e/user-guide-screenshots.spec.ts`
- Create: `src/components/help/screens/inbox-light.png`, `inbox-dark.png`
- Create: `src/components/help/screens/tasks-list-light.png`, `tasks-list-dark.png`
- Create: `src/components/help/screens/tasks-search-light.png`, `tasks-search-dark.png`
- Create: `src/components/help/screens/tasks-detail-light.png`, `tasks-detail-dark.png`
- Create: `src/components/help/screens/tasks-setup-light.png`, `tasks-setup-dark.png`

**Interfaces:**
- Consumes: `capture(page,name,region,targets,options)` already in the spec; `stageReadingFolder` and `phase3Origin("viewer")`.
- Produces: the ten PNGs above, at the exact names Task 4 imports.

- [ ] **Step 1: Scope the capture run**

At the top of the spec, after `const output=process.env.KM_GUIDE_CAPTURE;`, add:

```ts
const only = process.env.KM_GUIDE_ONLY?.split(",").filter(Boolean);
const wanted = (name: string) => !only || only.includes(name);
```

Wrap the existing sequential block (from the `await page.goto` of the import page through the `sources` capture) in `if (wanted("existing")) { ... }`. Put the new work in `if (wanted("tasks") || wanted("inbox")) { ... }`.

- [ ] **Step 2: Seed and capture Tasks**

Inside the new block, on the fresh account's personal workspace `ws`:

```ts
const folder = await stageReadingFolder(page.request, { workspaceId: ws, sourceName: "Task references", fixture: "task-export-my-space" });
expect((await page.request.post(`/api/source-imports/${folder}/apply`, { data: {} })).ok()).toBe(true);
const binding = await (await page.request.post(`/api/workspaces/${ws}/task-export-bindings`, { data: { label: "macbook" } })).json();
const ingest = (body: unknown) => page.request.post("/api/task-results/ingest", {
  headers: { "x-knowledge-hub-export-token": binding.token }, data: body,
});
const firstId = crypto.randomUUID();
const artifact = {
  schemaVersion: 1, taskId: firstId, artifactRevision: 1, agent: "claude-code", status: "completed",
  title: "Harden the task export endpoint",
  summary: "Rejected oversized artifacts and unconfirmed revisions, then verified the retry path.",
  completedAt: "2026-11-09T14:05:00Z",
  verification: { status: "passed", checks: ["npm run test:unit -- task-export: 18 passed"] },
  findings: ["A retry after a lost response reused the saved artifact unchanged."],
  decisions: ["Kept rejection over silent truncation for artifacts above 64 KiB."],
  changes: ["src/app/api/task-results/ingest/route.ts"],
  references: [{ type: "WIKI", path: "space-guide.md" }, { type: "PR_URL", url: "https://github.com/example/hub/pull/42" }],
};
const created = await ingest(artifact);
expect(created.status()).toBe(201);
const { url: detailUrl } = await created.json();
expect((await ingest({ ...artifact, artifactRevision: 2, title: "Harden the task export endpoint v2" })).status()).toBe(201);
expect((await ingest({
  schemaVersion: 1, taskId: crypto.randomUUID(), artifactRevision: 1, agent: "opencode", status: "completed",
  title: "Document the rollout checklist", summary: "Wrote the read-cutover runbook for Task Search.",
  completedAt: "2026-11-08T09:30:00Z", verification: { status: "not_run" },
  references: [{ type: "CODE_FILE", path: "docs/operations/task-search-rollout.md" }],
})).status()).toBe(201);

await page.setViewportSize({ width: 1280, height: 800 });
await page.goto(`/w/${ws}/tasks`);
await capture(page, "tasks-list", content, [
  page.getByRole("link", { name: /Harden the task export endpoint v2/ }),
  page.getByRole("link", { name: "Set up export" }),
]);

await page.goto(detailUrl);
await capture(page, "tasks-detail", content, [
  page.getByRole("heading", { name: "Verification", exact: true }),
  page.getByRole("heading", { name: "References", exact: true }),
  page.getByRole("heading", { name: "Revisions", exact: true }),
]);

await page.goto(`/w/${ws}/tasks/setup`);
await expect(page.getByText("Copy the setup line now.")).toHaveCount(0);
await capture(page, "tasks-setup", content, [
  page.getByLabel("Label"),
  page.getByRole("button", { name: "Rotate token" }),
]);
```

This captures the legacy Tasks list; the search-enabled list is captured in Step 4 under the `search` name. `tasks-detail` and `tasks-setup` are shown in both flag states.

- [ ] **Step 3: Capture the Inbox**

```ts
const note = await (await page.request.post(`/api/workspaces/${ws}/documents`, { data: {
  title: "Release checklist",
  markdown: "Before shipping, confirm the deploy runbook is current and the rollback owner is available.",
} })).json();
const { link } = await (await page.request.post(`/api/documents/${note.documentId}/share-links`, { data: { label: "Review" } })).json();
const token = link.path.split("/").pop();
const viewer = phase3Origin("viewer");
const query = await (await page.request.post(`${viewer}/api/share-review/threads/query`, { headers: { Origin: viewer }, data: { token } })).json();
const comment = await page.request.post(`${viewer}/api/share-review/threads`, {
  headers: { Origin: viewer },
  data: {
    token, expectedRevisionId: query.revisionId,
    anchor: { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 63, endUtf16: 77, exact: "rollback owner", prefix: "the ", suffix: " is available." },
    body: "Could we name a backup rollback owner for the release window?", idempotencyKey: crypto.randomUUID(),
  },
});
expect(comment.status()).toBe(201);

await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto(`/w/${ws}/inbox`);
const rows = page.getByRole("list", { name: "Inbox discussions" }).getByRole("listitem");
await expect(rows.first()).toBeVisible({ timeout: 15_000 });
await rows.first().getByRole("link").click();
await expect(page.getByRole("region", { name: "Selected discussion" }).getByText("Could we name a backup rollback owner for the release window?")).toBeVisible({ timeout: 15_000 });
await capture(page, "inbox", page.locator("main"), [
  page.getByRole("group", { name: "Inbox relationships" }),
  rows.first(),
  page.getByRole("region", { name: "Selected discussion" }),
], { maxHeight: 820, margin: 0 });
```

- [ ] **Step 4: Capture the search-enabled list**

```ts
const port = Number(process.env.KM_E2E_PORT ?? "3101") + 19;
const searchOrigin = "http://127.0.0.1:" + port;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: process.cwd(), env: { ...process.env, NODE_ENV: "production", KM_IDENTITY_PROVIDER: "local", TASK_SEARCH_READ_ENABLED: "true", PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
try {
  const until = Date.now() + 40_000;
  while (Date.now() < until) {
    if (server.exitCode !== null) throw new Error("Task Search capture server exited.");
    try { await fetch(searchOrigin, { redirect: "manual" }); break; } catch { await new Promise((r) => setTimeout(r, 350)); }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${searchOrigin}/w/${ws}/tasks`);
  await expect(page.getByRole("searchbox", { name: "Search tasks" })).toBeVisible();
  await capture(page, "tasks-search", content, [
    page.getByRole("searchbox", { name: "Search tasks" }),
    page.getByRole("combobox", { name: "Agent" }),
    page.locator("#task-search-filter-form summary").first(),
    page.getByRole("button", { name: "Apply filters" }),
  ]);
} finally {
  server.kill("SIGTERM");
}
```

Add `import { spawn } from "node:child_process";` and `import { phase3Origin } from "./fixtures/phase3-identities";` and `import { stageReadingFolder } from "./fixtures/folder-reading";`.

- [ ] **Step 5: Run the capture**

Prerequisites: `make db-up` and, once per machine, `make browsers`.

Run:

```bash
make db-up
KM_GUIDE_ONLY=inbox,tasks pnpm run test:e2e -- tests/e2e/user-guide-screenshots.spec.ts
```

Expected: PASS, and the ten named PNGs appear/refresh under `src/components/help/screens/`.

- [ ] **Step 6: Verify the images**

Run: `ls -l src/components/help/screens/{inbox,tasks-list,tasks-search,tasks-detail,tasks-setup}-{light,dark}.png`
Expected: ten files, each non-zero.

Open `tasks-setup-light.png` and `inbox-light.png` and check: no setup-line/token text, the Inbox shows both columns and the numbered marks, and the marks match the captions planned in Task 4.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/user-guide-screenshots.spec.ts src/components/help/screens
git commit -m "test(help): capture Inbox and Tasks guide screens"
```

---

### Task 4: Wire the screens and captions

**Files:**
- Modify: `src/components/help/user-guide-screenshot.tsx`

**Interfaces:**
- Consumes: the PNGs from Task 3; the `only` filter from Task 2.
- Produces: shots keyed `inbox`, `tasks` for `UserGuideScreenshots`.

- [ ] **Step 1: Add the imports and shots**

Add ten static imports:

```ts
import inboxLight from "./screens/inbox-light.png";
import inboxDark from "./screens/inbox-dark.png";
import tasksListLight from "./screens/tasks-list-light.png";
import tasksListDark from "./screens/tasks-list-dark.png";
import tasksSearchLight from "./screens/tasks-search-light.png";
import tasksSearchDark from "./screens/tasks-search-dark.png";
import tasksDetailLight from "./screens/tasks-detail-light.png";
import tasksDetailDark from "./screens/tasks-detail-dark.png";
import tasksSetupLight from "./screens/tasks-setup-light.png";
import tasksSetupDark from "./screens/tasks-setup-dark.png";
```

Add entries to `SHOTS` (paths, captions and `only` values exactly as below; the marks are placed by the capture in the same order as the caption):

```ts
inbox: [
  { light: inboxLight, dark: inboxDark, path: ["My Space › Inbox", "My Space › 收件匣"],
    en: "① Switch relationship with All / My documents / Following / Mentions; ② select a discussion to read it in the pane; ③ reply or Resolve, and Open document opens the article.",
    zh: "① 用 All／My documents／Following／Mentions 切換關係；② 點一則討論在右側閱讀討論串；③ 回覆或 Resolve，Open document 開原文。" },
],
tasks: [
  { light: tasksListLight, dark: tasksListDark, path: ["My Space › Tasks", "My Space › Tasks"], only: "noTaskSearch",
    en: "① Each row is one Task Result; ② Set up export creates a binding for another machine.",
    zh: "① 每列是一個 Task Result；② Set up export 為另一台機器建立 binding。" },
  { light: tasksSearchLight, dark: tasksSearchDark, path: ["My Space › Tasks", "My Space › Tasks"], only: "taskSearch",
    en: "① Search title, summary and findings; ② filter by Agent; ③ by completed date; ④ Apply filters.",
    zh: "① 搜尋標題、摘要與 findings；② 依 Agent 篩選；③ 依完成日期篩選；④ 按 Apply filters。" },
  { light: tasksDetailLight, dark: tasksDetailDark, path: ["My Space › Tasks", "My Space › Tasks"],
    en: "① Verification is what the agent reported; ② References link back to Wiki pages and pull requests; ③ Revisions switch versions.",
    zh: "① Verification 是代理回報的結果；② References 連回 Wiki 文章與 PR；③ Revisions 切換版本。" },
  { light: tasksSetupLight, dark: tasksSetupDark, path: ["My Space › Tasks › Task export", "My Space › Tasks › Task export"],
    en: "① Label and create one binding per machine; ② Rotate token or Revoke a binding.",
    zh: "① 輸入 Label 為每台機器建立 binding；② 需要時 Rotate token 或 Revoke。" },
],
```

- [ ] **Step 2: Typecheck, lint and build**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds and the PNG imports resolve.

- [ ] **Step 3: Commit**

```bash
git add src/components/help/user-guide-screenshot.tsx
git commit -m "feat(help): show Tasks and Inbox screens with numbered steps"
```

---

### Task 5: Update the guide E2E test

**Files:**
- Modify: `tests/e2e/user-guide.spec.ts`

**Interfaces:**
- Consumes: all previous tasks; the E2E server runs with `TASK_SEARCH_READ_ENABLED=false`.
- Produces: assertions for the new order, headings, links, figure count and overflow.

- [ ] **Step 1: Update the figure count and add chapter assertions**

- Change both `await expect(page.getByRole("figure")).toHaveCount(13);` to `toHaveCount(19);`.
- After the existing "Daily sync" assertion, add in English:
  ```ts
  await expect(page.getByRole("heading", { name: "Inbox: discussions, mentions and shares", exact: true })).toBeAttached();
  await expect(page.getByRole("heading", { name: "Tasks: results from coding agents", exact: true })).toBeAttached();
  await expect(page.getByText("Search title, summary and findings", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open Inbox", exact: true })).toHaveAttribute("href", `/w/${ws}/inbox`);
  await expect(page.getByRole("link", { name: "Open Tasks", exact: true })).toHaveAttribute("href", `/w/${ws}/tasks`);
  await expect(page.getByRole("link", { name: "Set up export", exact: true })).toHaveAttribute("href", `/w/${ws}/tasks/setup`);
  ```
- Add the zh-TW equivalents after the Chinese toggle:
  ```ts
  await expect(page.getByRole("heading", { name: "收件匣：討論、提及與分享", exact: true })).toBeAttached();
  await expect(page.getByRole("heading", { name: "Tasks：代理完成的任務", exact: true })).toBeAttached();
  await expect(page.getByRole("link", { name: "開啟 Inbox", exact: true })).toHaveAttribute("href", `/w/${ws}/inbox`);
  await expect(page.getByRole("link", { name: "設定 Task export", exact: true })).toHaveAttribute("href", `/w/${ws}/tasks/setup`);
  ```

- [ ] **Step 2: Cover the new chapters in the anchor and layout loop**

- Add `#inbox` and `#tasks` to the chapter-navigation scroll checks: scroll to `#inbox` and expect the `收件匣` link to have `aria-current="location"`; scroll to `#tasks` and expect `Tasks`.
- Change the final loop's id array to
  `["quick-start", "sync", "troubleshooting", "reading", "inbox", "insights", "tasks", "sharing-export"]`.
- Add a scroll to `#inbox` at 390px and expect no horizontal overflow (the loop already checks each figure).

- [ ] **Step 3: Run the guide E2E test**

Prerequisites: `make db-up`, `make browsers`.

Run: `pnpm run test:e2e -- tests/e2e/user-guide.spec.ts`
Expected: PASS.

- [ ] **Step 4: Run the local mirror of the CI gate**

Run: `make verify`
Expected: unit, typecheck, lint and build all pass.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/user-guide.spec.ts
git commit -m "test(help): cover the Tasks and Inbox chapters"
```

---

## Self-Review Notes

- Spec §7.1 (content) → Task 1; §7.2 (diagrams) → Task 1; §7.3 (screens) → Tasks 3–4; §7.4 (capture) → Task 3; §7.5 (page/nav) → Task 2; §7.6 (tests) → Tasks 1, 2, 5.
- The search flag is tested at both ends: unit content (Task 1), helper (Task 2), E2E absence on the default server (Task 5), capture presence on the flag-on server (Task 3).
- No task changes product behaviour, permissions or routes.
- The only open choices left to the implementer are the final bilingual prose and seed titles, both bounded by the spec and the exact captions above.
