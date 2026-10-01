# 焦點列單鍵動作 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓知識樹上的焦點列能用單鍵執行 registry 動作（`j`/`k` 移動，`E` 編輯、`F` 收藏、`M` 移動、`R` 重新命名、資料夾上 `C` 在其內新增文件），目標由鍵盤焦點決定。

**Architecture:** 樹的 `handleKeyDown` 對焦點列從既有的 `documentActions`/`folderActions` 找 `shortcut` 相符的動作並用 `onRunAction` 執行；樹只接管 registry 的靜態表 `rowShortcuts` 為該種列宣告過的鍵，其餘照舊交給 `QuickSearch` 的全域監聽，後者遇到已被處理的事件就略過。「事件 + 動作清單 → 相符動作」是 `src/lib/shortcut-keys.ts` 的純函式，兩邊共用。

**Tech Stack:** Next.js 15 / React、Vitest（`tests/unit`，樹用 jsdom）、Playwright（`tests/e2e`）、Base UI menu。

**Spec:** `docs/superpowers/specs/2026-10-02-row-keyboard-actions-design.md`（已核可）。執行者兩份都要讀。

## Global Constraints

- 不改授權：鍵只是啟動 registry 動作；可用性只由 registry 決定，樹不重寫任何條件（spec §3.2）。
- 單鍵觸發條件一律沿用 `isSingleKeyShortcut`（不帶 `⌘`/`Ctrl`/`Alt`、不在輸入法組字、不在輸入框／對話框／menu／listbox、不是重複事件、字母不帶 Shift）。
- `Alt+↑/↓` 重排行為不得改變；`C`、`E`、`/` 既有行為（`tests/e2e/keyboard-shortcuts.spec.ts`）與 `tests/e2e/row-actions.spec.ts` 必須維持通過。
- 文件列按 `C` 仍新增文件（全域）；唯讀列按 `E` 什麼都不做，且不得落到正在閱讀的那份文件。
- 封存不配單鍵；`aria-selected` 維持「目前頁」，不加多選。
- 前端：只用 `tailwind.config.ts` 定義的 token 名稱（`text-body`、`rounded-md`…），顏色只用 CSS 變數；沒有 `text-sm`、`rounded` 這類預設拼法。
- 專案命令：用 `make`（或 `node_modules/.bin/…`），不要用裸 `npm`/`npx`（nvm 函式在非互動 shell 會失敗）；不要把測試輸出 pipe 掉 exit code。e2e 前先 `lsof -nP -iTCP:3101 -sTCP:LISTEN`，埠被別的 worktree 占用就等，不要 kill。
- commit 訊息結尾：`Claude-Session: https://claude.ai/code/session_01QnFD3TyBBPqjvZRJd15Ddq`。

## File Structure

```text
修改  src/lib/shortcut-keys.ts                       actionForKey（純函式）
修改  src/components/actions/action-registry.ts      rowShortcuts、claimedRowKeys；六個動作的 shortcut 改讀它
修改  src/components/knowledge/knowledge-tree.tsx    handleKeyDown：j/k 與焦點列單鍵
修改  src/components/search/quick-search.tsx         單鍵分支略過已處理事件；改用 actionForKey
修改  src/components/actions/action-menu.tsx         選單項目顯示 Kbd 與 aria-keyshortcuts；寬度
新增  tests/e2e/zz-row-keyboard-actions.spec.ts      （spec §6.2 寫作 row-keyboard-actions.spec.ts；改 zz- 前綴是因為它在 My Space 做變更，與 zz-organize*.spec.ts 同理，Task 6 一併更正 spec）
修改  tests/unit/shortcut-keys.test.ts
修改  tests/unit/action-registry.test.ts
新增  tests/unit/knowledge-tree-row-keys.test.tsx
修改  docs/superpowers/specs/frontend-design-language.md  §10、§18
修改  docs/superpowers/specs/2026-09-24-keyboard-shortcuts-design.md  狀態行
修改  docs/superpowers/specs/2026-10-02-row-keyboard-actions-design.md  狀態、檔名
修改  README.md                                       canonical documents 表
```

---

### Task 1: `actionForKey` 純函式

**Files:**
- Modify: `src/lib/shortcut-keys.ts`（檔尾追加）
- Test: `tests/unit/shortcut-keys.test.ts`（檔尾追加一個 `describe`）

**Interfaces:**
- Consumes: 無。
- Produces: `export function actionForKey<A extends { shortcut?: string }>(actions: readonly A[], event: { key: string }): A | undefined` — 回傳 `shortcut` 小寫後恰等於 `event.key` 小寫的第一個動作；`"Meta+I Control+I"` 這種帶修飾鍵或多組的 `shortcut` 不會相符。

- [ ] **Step 1: 寫失敗的測試**

在 `tests/unit/shortcut-keys.test.ts` 的 import 加上 `actionForKey`，檔尾追加：

```ts
describe("actionForKey", () => {
  const edit = { id: "document.edit", shortcut: "E" };
  const move = { id: "document.move", shortcut: "M" };
  const details = { id: "document.details", shortcut: "Meta+I Control+I" };
  const plain = { id: "document.open" };
  const actions = [plain, edit, details, move];

  it("finds the action whose single-key shortcut is the key", () => {
    expect(actionForKey(actions, { key: "e" })).toBe(edit);
    expect(actionForKey(actions, { key: "m" })).toBe(move);
  });

  it("compares by what the key types, so a capital is the same key", () => {
    expect(actionForKey(actions, { key: "E" })).toBe(edit);
  });

  it("never matches a shortcut that carries a modifier, or an action with none", () => {
    expect(actionForKey(actions, { key: "i" })).toBeUndefined();
    expect(actionForKey([plain], { key: "e" })).toBeUndefined();
  });

  it("returns nothing for a key no action takes, and for an empty list", () => {
    expect(actionForKey(actions, { key: "z" })).toBeUndefined();
    expect(actionForKey([], { key: "e" })).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node_modules/.bin/vitest run --config vitest.config.ts tests/unit/shortcut-keys.test.ts`
Expected: FAIL，`actionForKey is not a function`（或 import 錯誤）。

- [ ] **Step 3: 實作**

在 `src/lib/shortcut-keys.ts` 檔尾追加：

```ts
/**
 * The action a single key runs: the first whose registry `shortcut` is that key. A shortcut with a
 * modifier ("Meta+I Control+I") is never equal to one key, so it is never found here; that is
 * `matchesShortcut`'s. Shared by the palette's listener and the tree's, so the rule is written once.
 */
export function actionForKey<A extends { shortcut?: string }>(actions: readonly A[], event: { key: string }): A | undefined {
  const key = event.key.toLowerCase();
  return actions.find((action) => action.shortcut?.toLowerCase() === key);
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node_modules/.bin/vitest run --config vitest.config.ts tests/unit/shortcut-keys.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/shortcut-keys.ts tests/unit/shortcut-keys.test.ts
git commit -m "feat(shortcuts): actionForKey，單鍵比對規則只寫一處"
```

---

### Task 2: registry 的 `rowShortcuts` 與 `claimedRowKeys`

**Files:**
- Modify: `src/components/actions/action-registry.ts`（`NAV_TOGGLE_SHORTCUT` 附近新增；`document.edit`（約 374 行）、`document.favorite`（約 405 行）、`document.move`（約 458 行）、`folder.new-document`（約 501 行）、`folder.rename`（約 519 行）、`folder.move`（約 528 行）六個動作的 `shortcut`）
- Test: `tests/unit/action-registry.test.ts`（`describe("action registry — shortcuts"` 內追加）

**Interfaces:**
- Consumes: 無。
- Produces:
  - `export const rowShortcuts = { "document.edit": "E", "document.favorite": "F", "document.move": "M", "folder.new-document": "C", "folder.move": "M", "folder.rename": "R" } as const`
  - `export function claimedRowKeys(kind: "document" | "folder"): ReadonlySet<string>` — 該種列宣告過的鍵（小寫）。文件：`e f m`；資料夾：`c m r`。

- [ ] **Step 1: 寫失敗的測試**

在 `tests/unit/action-registry.test.ts` 的 import 加上 `claimedRowKeys`、`rowShortcuts`，並在 `describe("action registry — shortcuts", …)` 的最後一個 `it` 之後、該 `describe` 結束的 `});` 之前追加：

```ts
  const shortcutsOn = (surface: ActionSurface, ctx: ActionContext) =>
    actionsFor(surface, ctx)
      .map((action) => action.shortcut)
      .filter((shortcut): shortcut is string => Boolean(shortcut));

  it("binds F and M on a document row, and C, M and R on a folder row", () => {
    expect(shortcutsOn("row", context({ target: target() })).sort()).toEqual(["E", "F", "M"]);
    expect(shortcutsOn("row", context({ folder: folder() })).sort()).toEqual(["C", "M", "R"]);
  });

  it("gives no two actions on one surface the same key (C means two things, on two kinds of target)", () => {
    for (const [surface, ctx] of [
      ["row", context({ target: target() })],
      ["row", context({ folder: folder() })],
      ["palette", context({ target: target() })],
    ] as const) {
      const keys = shortcutsOn(surface, ctx);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("reads every row action's shortcut from rowShortcuts, so there is one source", () => {
    const seen = [
      ...availableActions(context({ target: target() })),
      ...availableActions(context({ folder: folder() })),
    ];
    for (const action of seen) {
      if (action.id in rowShortcuts) expect(action.shortcut).toBe(rowShortcuts[action.id as keyof typeof rowShortcuts]);
    }
  });

  it("claims a kind's keys even where the registry offers none of them, so a read-only row keeps its keys", () => {
    expect([...claimedRowKeys("document")].sort()).toEqual(["e", "f", "m"]);
    expect([...claimedRowKeys("folder")].sort()).toEqual(["c", "m", "r"]);
    const readOnly = availableActions(context({ target: target({ ownership: "SOURCE_MANAGED" }) }));
    expect(readOnly.some((action) => action.id === "document.edit")).toBe(false);
    expect(claimedRowKeys("document").has("e")).toBe(true);
  });

  it("leaves C on a document row to the global Create document", () => {
    expect(claimedRowKeys("document").has("c")).toBe(false);
  });
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node_modules/.bin/vitest run --config vitest.config.ts tests/unit/action-registry.test.ts`
Expected: FAIL，`rowShortcuts`/`claimedRowKeys` 未定義。

- [ ] **Step 3: 實作**

在 `NAV_TOGGLE_SHORTCUT`（約 120 行）之後新增：

```ts
/**
 * The key each row action takes (row-keyboard-actions spec §4.2). An action reads its `shortcut`
 * from here, so binding, `aria-keyshortcuts` and the hint on screen still have one source. It is
 * data rather than a field on the built action because an action the caller may not run is not
 * built at all, and the tree must still know the key is its own: `E` on a read-only row is
 * taken and does nothing, it is not passed on to edit the document being read.
 */
export const rowShortcuts = {
  "document.edit": "E",
  "document.favorite": "F",
  "document.move": "M",
  "folder.new-document": "C",
  "folder.move": "M",
  "folder.rename": "R",
} as const;

/** The keys, lower-cased, that a focused row of this kind takes for itself. */
export function claimedRowKeys(kind: "document" | "folder"): ReadonlySet<string> {
  return new Set(
    Object.entries(rowShortcuts)
      .filter(([id]) => id.startsWith(`${kind}.`))
      .map(([, key]) => key.toLowerCase()),
  );
}
```

然後改六個動作：
- `document.edit`：`shortcut: "E",` → `shortcut: rowShortcuts["document.edit"],`
- `document.favorite`（在 `keywords` 與 `surfaces` 之間）加：`shortcut: rowShortcuts["document.favorite"],`
- `document.move`：加 `shortcut: rowShortcuts["document.move"],`
- `folder.new-document`：加 `shortcut: rowShortcuts["folder.new-document"],`
- `folder.rename`：加 `shortcut: rowShortcuts["folder.rename"],`
- `folder.move`：加 `shortcut: rowShortcuts["folder.move"],`

- [ ] **Step 4: 跑測試確認通過**

Run: `node_modules/.bin/vitest run --config vitest.config.ts tests/unit/action-registry.test.ts`
Expected: PASS（含既有的「binds C … E」與「gives no two actions the same shortcut」）。

- [ ] **Step 5: Commit**

```bash
git add src/components/actions/action-registry.ts tests/unit/action-registry.test.ts
git commit -m "feat(actions): rowShortcuts——列動作的鍵集中宣告，F、M、R 與資料夾 C"
```

---

### Task 3: 樹接管焦點列的鍵，全域讓路

**Files:**
- Modify: `src/components/knowledge/knowledge-tree.tsx`（import；`handleKeyDown` 約 368–443 行）
- Modify: `src/components/search/quick-search.tsx`（import 約 24 行；單鍵分支約 157–168 行）
- Test: `tests/unit/knowledge-tree-row-keys.test.tsx`（新增）

**Interfaces:**
- Consumes: Task 1 的 `actionForKey`；Task 2 的 `claimedRowKeys`；既有 `isSingleKeyShortcut(event: KeyEventLike)`。
- Produces: 行為（無新匯出）：
  - 焦點在某個 `treeitem` 內，單鍵 `j`/`k` 等同 `↓`/`↑`。
  - 該列種類宣告過的鍵：可用則 `onRunAction(action)`，不可用則不做事；兩者都 `preventDefault()`。
  - 沒宣告的鍵不碰（不 `preventDefault`）。
  - `QuickSearch` 單鍵分支在 `event.defaultPrevented` 時略過；`/` 分支在它前面，不受影響。

- [ ] **Step 1: 寫失敗的測試**

新增 `tests/unit/knowledge-tree-row-keys.test.tsx`（harness 照抄 `tests/unit/knowledge-tree-reorder.test.tsx` 的前 80 行寫法：jsdom、mock `next/navigation` 與 `next/link`、`createRoot`、`act`）：

```tsx
// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgeTree } from "@/components/knowledge/knowledge-tree";
import type { Action } from "@/components/actions/action-registry";
import type { KnowledgeTreeItem } from "@/modules/knowledge/application/knowledge-query-service";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return {
    default: ({ href, children, prefetch, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => {
      void prefetch;
      return h("a", { href, ...rest }, children);
    },
  };
});

/**
 * Row keys (row-keyboard-actions spec §3–4): the key goes to the row in focus, the tree takes only the
 * keys it has declared for that kind of row, and what it does not take is left to the page.
 */

const doc = (label: string, position: number): KnowledgeTreeItem => ({
  type: "document", id: `n:${label}`, parentId: null, documentId: `d:${label}`, label, currentRevisionId: `r:${label}`, position, status: "ACTIVE",
});
const folder: KnowledgeTreeItem = { type: "folder", id: "n:F", parentId: null, label: "F", position: 2, status: "ACTIVE" };
const items = [doc("A", 0), doc("B", 1), folder];

const action = (id: Action["id"], shortcut: string): Action => ({
  id, label: id, group: id.startsWith("folder") ? "folder" : "document", icon: "open", keywords: [], shortcut, surfaces: ["row"],
  effect: { kind: "navigate", href: "/x" },
});
const editAction = action("document.edit", "E");
const newHereAction = action("folder.new-document", "C");

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.localStorage.clear();
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

type Props = Partial<ComponentProps<typeof KnowledgeTree>>;
function render(props: Props = {}) {
  const onRunAction = props.onRunAction ?? vi.fn();
  act(() =>
    root.render(
      createElement(KnowledgeTree, {
        items,
        workspaceId: "w1",
        sourceId: "s1",
        favoriteDocumentIds: new Set<string>(),
        onToggleFavorite: () => {},
        documentActions: () => [editAction],
        folderActions: () => [newHereAction],
        onRunAction,
        onReorder: async () => true,
        ...props,
      }),
    ),
  );
  return { onRunAction };
}

const rowFor = (label: string) => container.querySelector<HTMLElement>(`[role=treeitem][aria-label="${label}"]`)!;

function press(target: HTMLElement, key: string, init: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(event); });
  return event;
}

describe("a key on the row in focus", () => {
  it("runs the row's own action for it, and takes the key", () => {
    const { onRunAction } = render();
    const event = press(rowFor("A"), "e");
    expect(onRunAction).toHaveBeenCalledWith(editAction);
    expect(event.defaultPrevented).toBe(true);
  });

  it("goes by the row's kind: C on a folder is its New document here", () => {
    const { onRunAction } = render();
    press(rowFor("F"), "c");
    expect(onRunAction).toHaveBeenCalledWith(newHereAction);
  });

  it("takes a key the row's kind has declared even when the registry offers nothing for it, and does nothing", () => {
    const { onRunAction } = render({ documentActions: () => [] });
    const event = press(rowFor("A"), "e");
    expect(onRunAction).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true); // so the page's own E does not edit the document being read
  });

  it("leaves a key the row's kind has not declared to the page: C on a document is still Create document", () => {
    const { onRunAction } = render();
    const event = press(rowFor("A"), "c");
    expect(onRunAction).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("does not act on a modified key, a held key or a composed one", () => {
    const { onRunAction } = render();
    press(rowFor("A"), "e", { metaKey: true });
    press(rowFor("A"), "e", { ctrlKey: true });
    press(rowFor("A"), "e", { repeat: true });
    press(rowFor("A"), "e", { isComposing: true });
    expect(onRunAction).not.toHaveBeenCalled();
  });

  it("does not act on a key typed into a field", () => {
    const { onRunAction } = render();
    const input = document.createElement("input");
    rowFor("A").appendChild(input);
    const event = press(input, "e");
    expect(onRunAction).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("does not act on a key that came from a menu rendered into the body", () => {
    const { onRunAction } = render();
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("div");
    menu.appendChild(item);
    document.body.appendChild(menu);
    press(item, "e");
    expect(onRunAction).not.toHaveBeenCalled();
  });
});

describe("j and k", () => {
  it("move the focus as the arrows do", () => {
    render();
    act(() => rowFor("A").focus());
    press(rowFor("A"), "j");
    expect(document.activeElement).toBe(rowFor("B"));
    press(rowFor("B"), "k");
    expect(document.activeElement).toBe(rowFor("A"));
  });

  it("stop at the ends, as the arrows do", () => {
    render();
    act(() => rowFor("A").focus());
    press(rowFor("A"), "k");
    expect(document.activeElement).toBe(rowFor("A"));
  });

  it("are not the arrows when a modifier is held (Alt+J is not a move)", () => {
    render();
    act(() => rowFor("A").focus());
    press(rowFor("A"), "j", { altKey: true });
    expect(document.activeElement).toBe(rowFor("A"));
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node_modules/.bin/vitest run --config vitest.config.ts tests/unit/knowledge-tree-row-keys.test.tsx`
Expected: FAIL（`onRunAction` 沒被呼叫、`j` 沒移動焦點）。

- [ ] **Step 3: 實作樹**

`knowledge-tree.tsx` 的 import 區加：

```ts
import { claimedRowKeys, type Action } from "@/components/actions/action-registry";
import { actionForKey, isSingleKeyShortcut } from "@/lib/shortcut-keys";
```
（`Action` 檔內已有 type import 的話，併入同一行，不要重複 import。）

在 `handleKeyDown` 中，緊接著 `focusAt` 定義（約 393 行）之後、`switch (event.key)` 之前插入，並把 `switch (event.key)` 改成 `switch (arrow)`：

```ts
    // A single key is only a key where it is not a character (`isSingleKeyShortcut`): not in a field, a
    // dialog or a menu, not with a modifier. Row keys and `j`/`k` ask that first.
    const single = isSingleKeyShortcut(event.nativeEvent) ? event.key.toLowerCase() : "";
    if (single && current?.dataset.nodeId) {
      const item = itemById.get(current.dataset.nodeId);
      if (item && claimedRowKeys(item.type).has(single)) {
        // The tree takes the key even where the row may not do the thing: the registry offers no Edit on a
        // read-only row, and the page's own E must not edit the document being read instead.
        event.preventDefault();
        const actions = item.type === "document" ? documentActions(item) : folderActions(item);
        const action = actionForKey(actions, event);
        if (action) onRunAction(action);
        return;
      }
    }
    // j and k are the arrows' other spelling; held with a modifier they are not keys at all.
    const arrow = single === "j" ? "ArrowDown" : single === "k" ? "ArrowUp" : event.key;
```

`switch (event.key) {` → `switch (arrow) {`。（`case "ArrowDown":` 等不用改。）

- [ ] **Step 4: 實作全域讓路**

`quick-search.tsx` 的 import（約 24 行）：

```ts
import { actionForKey, isSingleKeyShortcut, shortcutLabel } from "@/lib/shortcut-keys";
```

單鍵分支（約 164–168 行）：

```ts
      const key = event.key.toLowerCase();
      const action = actions.find((candidate) => candidate.shortcut?.toLowerCase() === key);
      if (!action) return;
```
改為：

```ts
      // The tree answers the keys it has declared for the row in focus, and says so by taking the event
      // (row-keyboard-actions spec §4.2). `/` is above and never the tree's.
      if (event.defaultPrevented) return;
      const action = actionForKey(actions, event);
      if (!action) return;
```
（刪掉不再用的 `const key`。）

- [ ] **Step 5: 跑測試與型別／lint**

Run: `node_modules/.bin/vitest run --config vitest.config.ts tests/unit/knowledge-tree-row-keys.test.tsx tests/unit/knowledge-tree-reorder.test.tsx tests/unit/shortcut-keys.test.ts tests/unit/action-registry.test.ts`
Expected: 全部 PASS（含 Alt+arrow 重排的既有測試）。
Run: `make typecheck lint`
Expected: exit 0。

- [ ] **Step 6: Commit**

```bash
git add src/components/knowledge/knowledge-tree.tsx src/components/search/quick-search.tsx tests/unit/knowledge-tree-row-keys.test.tsx
git commit -m "feat(tree): 焦點列的單鍵動作與 j/k；樹接管它宣告的鍵，其餘交給全域"
```

---

### Task 4: 選單顯示鍵

**Files:**
- Modify: `src/components/actions/action-menu.tsx`（`ActionMenuItems` 約 148–163 行；`RowActionsTrigger` 的 `MenuContent className="w-48"` 約 196 行；import 區）

**Interfaces:**
- Consumes: Task 2 的動作 `shortcut` 欄位；既有 `Kbd`（`@/components/ui/kbd`）、`shortcutLabel`（`@/lib/shortcut-keys`）。
- Produces: 每個選單項目在 `action.shortcut` 存在時顯示 `Kbd`，並帶 `aria-keyshortcuts`。選單只有樹在用，所以提示與行為一致。

這一項的驗證在 Task 5 的 e2e（選單需要 Base UI 的 Root，單元測試不好 mount）。

- [ ] **Step 1: 實作**

import 區加：

```ts
import { Kbd } from "@/components/ui/kbd";
import { shortcutLabel } from "@/lib/shortcut-keys";
```

`ActionMenuItems` 的項目改成：

```tsx
        <MenuItem key={action.id} aria-keyshortcuts={action.shortcut} onClick={() => onRun(action)}>
          <ActionIcon name={action.icon} />
          <span className="min-w-0 flex-1 truncate">{action.label}</span>
          {action.shortcut ? <Kbd className="shrink-0">{shortcutLabel(action.shortcut)}</Kbd> : null}
        </MenuItem>
```

`RowActionsTrigger` 裡 `<MenuContent align="end" className="w-48">` 改為 `w-56`（鍵加進去後 "Remove from favorites" 在 192px 會被截）。`ContextMenuContent` 依列的內容定寬（`ui/menu.tsx` 註解：「sizes to its rows」），不用改。

- [ ] **Step 2: 型別與 lint**

Run: `make typecheck lint`
Expected: exit 0。若 `MenuItem` 不接受 `aria-keyshortcuts`，改為只加 `Kbd`，並在 Step 3 的 e2e 以 `kbd` 文字斷言（`aria-keyshortcuts` 不是 spec 要求，只是順手）。

- [ ] **Step 3: Commit**

```bash
git add src/components/actions/action-menu.tsx
git commit -m "feat(menu): 列選單顯示動作的鍵"
```

---

### Task 5: e2e

**Files:**
- Create: `tests/e2e/zz-row-keyboard-actions.spec.ts`

**Interfaces:**
- Consumes: `tests/e2e/fixtures/organize.ts` 的 `ROUND_TRIP`、`mySpace`、`openKnowledge`、`row`、`unique`；`tests/e2e/fixtures/palette.ts` 的 `openPalette`；種子資料常數（與 `row-actions.spec.ts` 相同：`QUERY_MASTER_WORKSPACE`、`OBSIDIAN_SOURCE`；`Runbooks`、`Architecture` 是可編輯的 `HUB_MANAGED`，`Compliance Policy` 在 `Vendor Compliance Vault` 內、是 `SOURCE_MANAGED`）。
- Produces: 覆蓋 spec §6.2 的整組情境。

My Space 的測試用 API 建立文件與資料夾（做法同 `zz-organize-move.spec.ts` 的 `apiFolder`／`apiDocument`），名稱用 `unique()`，彼此不依賴。

- [ ] **Step 1: 寫 spec**

```ts
import { expect, test, type Locator, type Page } from "@playwright/test";
import { ROUND_TRIP, mySpace, openKnowledge, row, unique } from "./fixtures/organize";
import { openPalette } from "./fixtures/palette";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS: a workspace with a SOURCE_MANAGED source in it, read here and never changed.
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const OBSIDIAN_SOURCE = "0199f100-0000-7000-8000-000000000101";

/**
 * Row keys (row-keyboard-actions spec): the key goes to the row in focus, not the document being read.
 * Works in the E2E user's own My Space with documents and folders made through the API, and sorts last for
 * the reason zz-organize.spec.ts gives. The read-only case uses the seeded workspace, read and never changed.
 */

async function apiDocument(page: Page, workspaceId: string, title: string) {
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown: `Body of ${title}.` } });
  expect(response.status()).toBe(201);
  return (await response.json()) as { documentId: string; sourceId: string };
}

async function apiFolder(page: Page, workspaceId: string, name: string) {
  const response = await page.request.post(`/api/workspaces/${workspaceId}/folders`, { data: { name } });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { treeNodeId: string }).treeNodeId;
}

/**
 * A key pressed before hydration reaches no listener. `j` is harmless to repeat, so press it until the focus
 * leaves `from` (where it goes depends on the order the tree draws, which is not the point), then put it back.
 */
async function armTree(page: Page, from: Locator) {
  await from.focus();
  await expect(async () => {
    await page.keyboard.press("j");
    await expect(from).not.toBeFocused({ timeout: 1_000 });
  }).toPass(ROUND_TRIP);
  await from.focus();
}

/** A tree to act on: the seed document being read, and two more documents and a folder beside it. */
async function setUp(page: Page) {
  const workspaceId = await mySpace(page);
  const a = unique("Row A");
  const b = unique("Row B");
  const folder = unique("Row F");
  const docA = await apiDocument(page, workspaceId, a);
  await apiDocument(page, workspaceId, b);
  const folderId = await apiFolder(page, workspaceId, folder);
  await openKnowledge(page, workspaceId);
  await page.reload();
  await expect(row(page, a)).toBeVisible(ROUND_TRIP);
  return { workspaceId, a, b, folder, folderId, docA };
}

test("j and k move the focus like the arrows, and Alt+j does not", async ({ page }) => {
  const { a } = await setUp(page);
  await armTree(page, row(page, a)); // leaves the focus on `a`, having proved that j moves it
  await page.keyboard.press("j");
  await expect(row(page, a)).not.toBeFocused();
  await page.keyboard.press("k");
  await expect(row(page, a)).toBeFocused();
  await page.keyboard.press("Alt+j");
  await expect(row(page, a)).toBeFocused();
});

test("E edits the row in focus, not the document being read", async ({ page }) => {
  const { a, docA } = await setUp(page);
  const reading = page.url();
  await armTree(page, row(page, a));
  await page.keyboard.press("e");
  await expect(page).toHaveURL(new RegExp(`/knowledge/${docA.sourceId}/${docA.documentId}/edit$`), ROUND_TRIP);
  expect(page.url()).not.toBe(reading);
});

test("F favourites the row in focus, and the menu then offers the way back", async ({ page }) => {
  const { a } = await setUp(page);
  await armTree(page, row(page, a));
  await page.keyboard.press("f");
  await expect(page.getByRole("region", { name: "Favorites" }).getByRole("link", { name: new RegExp(a) })).toBeVisible(ROUND_TRIP);
  await row(page, a).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Remove from favorites" })).toBeVisible();
});

test("M opens Move for the row in focus, and closing it puts the focus back on that row", async ({ page }) => {
  const { b } = await setUp(page);
  await armTree(page, row(page, b));
  await page.keyboard.press("m");
  const dialog = page.getByRole("dialog", { name: "Move document" });
  await expect(dialog).toBeVisible(ROUND_TRIP);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(row(page, b)).toBeFocused();
});

test("R renames the folder in focus", async ({ page }) => {
  const { a, folder } = await setUp(page);
  await armTree(page, row(page, a));
  await row(page, folder).focus();
  await page.keyboard.press("r");
  await expect(page.getByRole("dialog", { name: "Rename folder" })).toBeVisible(ROUND_TRIP);
});

test("C on a folder starts a document inside it, and on a document it is still Create document", async ({ page }) => {
  const { a, folder, folderId } = await setUp(page);
  await armTree(page, row(page, a));
  await row(page, folder).focus();
  await page.keyboard.press("c");
  await expect(page).toHaveURL(new RegExp(`/knowledge/new\\?folder=${folderId}$`), ROUND_TRIP);

  await page.goBack();
  await armTree(page, row(page, a));
  await page.keyboard.press("c");
  await expect(page).toHaveURL(/\/knowledge\/new$/, ROUND_TRIP);
});

test("with no row in focus, F favourites the document being read", async ({ page }) => {
  const { a, docA, workspaceId } = await setUp(page);
  await page.goto(`/w/${workspaceId}/knowledge/${docA.sourceId}/${docA.documentId}`);
  await expect(page.getByRole("heading", { name: a })).toBeVisible(ROUND_TRIP);
  await page.getByRole("heading", { name: a }).click();
  // Not a tree key: wait for the page to answer a key at all, then press the one that is not idempotent once.
  await openPalette(page, { settled: false });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("heading", { name: a }).click();
  await page.keyboard.press("f");
  await expect(page.getByRole("region", { name: "Favorites" }).getByRole("link", { name: new RegExp(a) })).toBeVisible(ROUND_TRIP);
});

test("a letter typed into the tree's filter stays in the filter", async ({ page }) => {
  await setUp(page);
  const before = page.url();
  await page.getByRole("button", { name: "Filter documents and sources" }).click();
  const filter = page.locator("#tree-filter");
  await filter.focus();
  await page.keyboard.type("efmrcjk");
  await expect(filter).toHaveValue("efmrcjk");
  expect(page.url()).toBe(before);
});

test("E on a read-only row does nothing, and does not edit the document being read", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}`);
  await expect(row(page, "Architecture")).toBeVisible(ROUND_TRIP);
  await page.waitForURL(/\/knowledge\/[^/]+\/[^/]+$/);
  await page.getByRole("button", { name: "Vendor Compliance Vault", exact: true }).click();
  const policy = row(page, "Compliance Policy");
  await expect(policy).toBeVisible(ROUND_TRIP);
  await openPalette(page, { settled: false });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const here = page.url();
  await policy.focus();
  await page.keyboard.press("e");
  await page.waitForTimeout(300);
  expect(page.url()).toBe(here);
});

test("the row menu shows each action's key, without truncating its label, and nothing for what is not offered", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}`);
  await expect(row(page, "Runbooks")).toBeVisible(ROUND_TRIP);
  await page.waitForURL(/\/knowledge\/[^/]+\/[^/]+$/);

  await row(page, "Runbooks").click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: /Edit document/ }).locator("kbd")).toHaveText("E");
  await expect(menu.getByRole("menuitem", { name: /Add to favorites/ }).locator("kbd")).toHaveText("F");
  await expect(menu.getByRole("menuitem", { name: /Move document/ }).locator("kbd")).toHaveText("M");
  const truncated = await menu.getByRole("menuitem").locator("span.truncate").evaluateAll((spans) => spans.filter((span) => span.scrollWidth > span.clientWidth).length);
  expect(truncated).toBe(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);

  await page.getByRole("button", { name: "Vendor Compliance Vault", exact: true }).click();
  await row(page, "Compliance Policy").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: /Edit document/ })).toHaveCount(0);
});
```

- [ ] **Step 2: 確認 3101 埠空著後跑**

Run: `lsof -nP -iTCP:3101 -sTCP:LISTEN || echo free` → 應顯示 `free`。
Run: `node_modules/.bin/tsx scripts/test/e2e.ts tests/e2e/zz-row-keyboard-actions.spec.ts`
Expected: 全部 PASS。若某案因種子資料（名稱、資料夾是否存在）失敗，**先看實際頁面再改測試**（讀 `test-results/*/error-context.md`），不要憑猜測改斷言；測試反映的是 spec，不是實作。

- [ ] **Step 3: 驗證測試真的會失敗（至少一個）**

暫時把 `knowledge-tree.tsx` 裡 `claimedRowKeys(item.type).has(single)` 改成 `false`，重跑上面的指令，預期「E edits the row in focus」「E on a read-only row」失敗；確認後還原。

- [ ] **Step 4: 跑受影響的既有 e2e**

Run: `node_modules/.bin/tsx scripts/test/e2e.ts tests/e2e/keyboard-shortcuts.spec.ts tests/e2e/row-actions.spec.ts tests/e2e/zz-organize-move.spec.ts tests/e2e/zz-organize.spec.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/zz-row-keyboard-actions.spec.ts
git commit -m "test(e2e): 焦點列單鍵——目標跟焦點、唯讀列不外溢、C 的兩種意義、選單顯示鍵"
```

---

### Task 6: 契約、舊規格、README，然後驗證並開 PR

**Files:**
- Modify: `docs/superpowers/specs/frontend-design-language.md`（§10 Shortcuts 約 408–413 行；§18 第 5 項約 1073–1078 行）
- Modify: `docs/superpowers/specs/2026-09-24-keyboard-shortcuts-design.md`（第 10 行「狀態」）
- Modify: `docs/superpowers/specs/2026-10-02-row-keyboard-actions-design.md`（「狀態」、§6.2 與 §8 的檔名）
- Modify: `README.md`（canonical documents 表，在 `Keyboard Shortcuts Implementation Plan` 那列之後）

**Interfaces:** 無程式介面。

- [ ] **Step 1: 契約 §10**

把這一段（「Single keys are bound in the palette … would be a lie on every row but one.」）整段：

```text
Single keys are bound in the palette (`quick-search.tsx`), from the same
actions it lists, so `E` exists exactly when "Edit document" is offered there:
on the document being read, when the registry's three availability axes allow
it. The row menu shows no hints. It acts on the row it was opened from, and a
row's "Edit document" beside an `E` that edits a different document would be
a lie on every row but one.
```

換成：

```text
Single keys act on the row in focus, and on the document being read when no
row is. The tree (`knowledge-tree.tsx`) takes the keys `rowShortcuts` declares
for the kind of row it is on (`E`, `F`, `M` for a document; `C`, `M`, `R` for a
folder), runs the row's own action for it, and takes the key even where the
registry offers the row nothing, so `E` on a read-only row does nothing and
does not edit the document being read. A key the kind has not declared is left
to the page: `C` on a document row is still Create document. The page's listener
(`quick-search.tsx`) binds the rest from the actions the palette lists, so with
no row in focus `E`, `F` and `M` act on the document being read, when the
registry's three availability axes allow it. `j` and `k` are the arrows' other
spelling inside the tree. The row menu shows each action's key: it is opened
from a row, and the key does that thing when that row has the focus. Row keys
spec: `docs/superpowers/specs/2026-10-02-row-keyboard-actions-design.md`.
```

- [ ] **Step 2: 契約 §18 第 5 項**

把

```text
 5. Two things are deferred on purpose, each with the condition that reopens
    it. List pages sit in `kh-page` rather than spanning the window; widen
    them when the Sources list is long enough that the width costs a reader
    something. `E` acts only on the document being read, not on the focused
    row (`docs/superpowers/specs/2026-09-24-keyboard-shortcuts-design.md`
    §3.2); revisit if rows gain actions a reader reaches by focus.
```

換成：

```text
 5. One thing is deferred on purpose, with the condition that reopens it. List
    pages sit in `kh-page` rather than spanning the window; widen them when the
    Sources list is long enough that the width costs a reader something. (`E`
    acting only on the document being read, not on the focused row, was the
    other half of this item; it closed when rows gained keys a reader reaches
    by focus: `docs/superpowers/specs/2026-10-02-row-keyboard-actions-design.md`.)
```

- [ ] **Step 3: 舊規格狀態行與本規格**

`2026-09-24-keyboard-shortcuts-design.md` 第 10 行 `| 狀態 | 已實作。第 9 節記錄實作時發現並一併修正的既存缺陷。 |` 改為：

```text
| 狀態 | 已實作。第 9 節記錄實作時發現並一併修正的既存缺陷。`E` 的目標（§3.2）與右鍵選單不顯示快捷鍵（§4.4）已被 `2026-10-02-row-keyboard-actions-design.md` 取代：目標由焦點決定，選單顯示鍵。 |
```

`2026-10-02-row-keyboard-actions-design.md`：「狀態」改為 `| 狀態 | 已核可，已實作（見 `docs/superpowers/plans/2026-10-02-row-keyboard-actions.md`） |`；§6.2 標題下的檔名與 §8 的 `tests/e2e/row-keyboard-actions.spec.ts` 都改成 `tests/e2e/zz-row-keyboard-actions.spec.ts`（它在 My Space 做變更，依既有 `zz-organize*.spec.ts` 的排序慣例加 `zz-`）。

- [ ] **Step 4: README**

在 `Keyboard Shortcuts Implementation Plan` 那列之後加兩列：

```text
| [Row Keyboard Actions Design](docs/superpowers/specs/2026-10-02-row-keyboard-actions-design.md) | 知識樹焦點列的單鍵動作（`j`/`k`、`E`、`F`、`M`、`R`、資料夾 `C`）：目標由焦點決定、樹只接管宣告過的鍵；取代 keyboard shortcuts 的 `E` 目標與選單不顯示鍵 |
| [Row Keyboard Actions Implementation Plan](docs/superpowers/plans/2026-10-02-row-keyboard-actions.md) | row keyboard actions tasks 與測試 |
```

- [ ] **Step 5: 整體驗證**

Run: `make verify`，檢查 exit code 為 0（不要 pipe）。
Run: `lsof -nP -iTCP:3101 -sTCP:LISTEN || echo free`，確認 `free` 後 `node_modules/.bin/tsx scripts/test/e2e.ts`（全部 e2e，約 6 分鐘）。
Expected: 全部 PASS。有失敗先用 `superpowers:systematic-debugging`，確認是本變更造成還是既有的時序問題，不要先改斷言。

- [ ] **Step 6: Commit、push、開 PR**

```bash
git add docs README.md
git commit -m "docs: 焦點列單鍵動作——契約 §10、§18.5、舊規格狀態與 README"
git push -u origin HEAD
gh pr create --base main --title "feat(tree): 焦點列的單鍵動作（j/k、E、F、M、R、資料夾 C）" --body "<依 spec §1–§9 摘要；列出驗證結果與 spec §9 的未驗證假設；結尾加 https://claude.ai/code/session_01QnFD3TyBBPqjvZRJd15Ddq>"
```
PR 描述裡要寫明兩個對外可見的行為變更：文件頁（沒有焦點列）按 `F`／`M` 會作用在正在讀的那份；選單現在顯示鍵。

---

## Self-Review

**Spec coverage**
- §2 範圍表與 `j`/`k`：Task 3（實作與單元）、Task 5（e2e 每個鍵）。
- §3.1 目標由焦點決定、§3.2 registry 唯一來源、§3.4 觸發條件：Task 3（沿用 `isSingleKeyShortcut`，含修飾鍵／組字／輸入框／menu 的單元反例）。
- §3.5 對話框關閉後焦點回到該列：Task 5 的 `M` 案。若失敗，這是 spec 說的「本規格要補的缺陷」，在 Task 5 Step 2 以 debugging 處理，不屬於本計畫預先寫好的修法（現況未驗證，spec §9 已標明）。
- §4.1 樹自己處理、共用純函式：Task 1、3。§4.2 宣告過的鍵：Task 2、3。§4.3 全域 `F`/`M` 行為：Task 5 的「with no row in focus」案。
- §5 顯示：Task 4、Task 5 最後一案（含截斷檢查、唯讀列沒有 Edit）。
- §6.1 unit：Task 1、2、3。§6.2 e2e：Task 5（`E` 優先於正在讀的、唯讀列不外溢、`C` 兩種、`F`、`M`＋焦點回歸、`R`、`j`/`k`＋`Alt`、無焦點列的 `F`、輸入框、選單顯示）。「palette／Move 對話框／選單開著時不觸發」由 `isSingleKeyShortcut` 的既有單元測試與 Task 3 的 menu／input 反例覆蓋，e2e 不重複。§6.3：Task 5 Step 4、Task 6 Step 5。
- §7 契約修訂：Task 6 Step 1–4。§8 檔案：File Structure 對得上，另外記錄 `zz-` 檔名調整。

**Placeholder scan:** 沒有 TBD／TODO。Task 6 Step 6 的 PR body 以 `<…>` 描述內容而非全文，這是唯一一處，執行時依 spec §9 與驗證結果現場寫。

**Type consistency:** `actionForKey`（Task 1）→ Task 3 兩處使用，簽名一致。`rowShortcuts`／`claimedRowKeys`（Task 2）→ Task 3 使用 `claimedRowKeys(item.type)`，`item.type` 為 `"document" | "folder"`，與參數型別一致。`Action["id"]` 在 Task 3 測試的 `action()` helper 使用 `"document.edit"`、`"folder.new-document"`，皆在 `ActionId` 內。

**已知風險**
- Task 4 的 `MenuItem` 是否接受 `aria-keyshortcuts` 未驗證，已在 Step 2 寫了退路。
- Task 5 假設種子資料中 `Runbooks`、`Architecture` 可編輯且在 `OBSIDIAN_SOURCE` 的樹裡、`Compliance Policy` 在 vault 內為 `SOURCE_MANAGED`（來自 `row-actions.spec.ts` 的既有斷言）；My Space 測試用 API 建資料，不依賴種子。
