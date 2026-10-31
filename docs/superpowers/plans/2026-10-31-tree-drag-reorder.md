# Tree drag reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pointer user can arrange rows in the Knowledge tree — reorder among siblings and move into folders — for `HUB_MANAGED` sources only, without changing the server, the keyboard path, or touch behavior.

**Architecture:** A pure `dropPlacement` translates (dragged row, target row, zone) into the two PATCH shapes the server already accepts. A `useTreeDrag` hook owns the drag state machine, the drop indicator, auto-expand, auto-scroll and feedback. `KnowledgeTree` wires the row props and draws the indicator; `useTreeMutations` gains a destination position and a toast for a refused move.

**Tech Stack:** Next.js 15 / React 19 client components, HTML5 drag-and-drop, Vitest (unit + integration), Playwright (Chromium).

**Spec:** `docs/superpowers/specs/2026-10-31-tree-drag-reorder-design.md`

## Global Constraints

- Only rows the registry offers `document.move` / `folder.move` for are draggable. No new permission code; `HUB_MANAGED`, ACTIVE, writable sources fall out of that test.
- No server, API, schema or migration change. The only request shapes are `{ position }` and `{ parentId, position? }`.
- `Alt+↑/↓` and the Move dialog keep their behavior and wording.
- Drag is offered only where `(hover: hover) and (pointer: fine)` matches. Touch is unchanged.
- No new design token: `--kh-primary` and `kh-bg-selected`.
- One PATCH per drop; no optimistic reorder.
- No new copy except `placedNode`: `Placed “X”. Position N of M.` (N is 1-based, counted over visible siblings).
- `make verify` must pass. Integration: `npx tsx scripts/test/integration.ts tests/integration/organize-api.test.ts`. E2E: `npx tsx scripts/test/e2e.ts --grep @tree-drag`.

## Review Focus

1. A folder dropped onto its own descendant must not be a target — placement unit test.
2. An expanded folder's bottom quarter must land after the whole subtree, not as its first child — placement unit + E2E.
3. A second drag while the first PATCH is in flight must be ignored — jsdom test.
4. Filtering must cancel `dragstart` and announce `CLEAR_FILTER_TO_REORDER`, not leave an inert row — jsdom test.
5. A click on a draggable row must still open the document — E2E.

---

### Task 1: The placement rule

**Files:**
- Modify: `src/lib/knowledge-navigation.ts` (after `reorderStep`)
- Create: `tests/unit/tree-drag-placement.test.ts`
- Modify: `tests/integration/organize-api.test.ts` (after the "step the tree asks for" describe)

**Interfaces:**
- Consumes: `KnowledgeTreeItem`, `moveDestinations`, the file's private `byPosition` comparator.
- Produces:
  ```ts
  export type DropZone = "before" | "after" | "into";
  export type DropPlacement =
    | { kind: "reorder"; position: number; index: number; count: number }
    | { kind: "move"; parentId: string | null; position?: number; index: number; count: number };
  export function dropPlacement(
    items: KnowledgeTreeItem[],
    draggedId: string,
    targetId: string,
    zone: DropZone,
  ): DropPlacement | null;
  ```
  `index` is the 0-based visible index after the drop; `count` the visible siblings after the drop; `position` the server index among all siblings. Into the current parent sends `Number.MAX_SAFE_INTEGER`; into another parent omits `position` so the server appends. `null` means "not a target".

- [ ] **Step 0: Commit the design and this plan**

```bash
git add docs/superpowers/specs/2026-10-31-tree-drag-reorder-design.md docs/superpowers/specs/2026-09-29-personal-daily-driver-design.md docs/superpowers/plans/2026-10-31-tree-drag-reorder.md
git commit -m "docs(knowledge): specify dragging rows in the tree"
```

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/tree-drag-placement.test.ts` with the fixture builders and these cases:

```ts
const doc = (label: string, position: number, parentId: string | null = null, status: "ACTIVE" | "ARCHIVED" = "ACTIVE"): KnowledgeTreeItem =>
  ({ type: "document", id: `n:${label}`, parentId, documentId: `d:${label}`, label, currentRevisionId: `r:${label}`, position, status });
const folder = (label: string, position: number, parentId: string | null = null, status: "ACTIVE" | "ARCHIVED" = "ACTIVE"): KnowledgeTreeItem =>
  ({ type: "folder", id: `n:${label}`, parentId, label, position, status });

// Hidden archived H sits between A and B; it is not in `items` because the client does not hold it.
const siblings = [doc("A", 0), doc("B", 2), doc("C", 3)];

it("crosses the archived sibling the client cannot see, both ways", () => {
  expect(dropPlacement(siblings, "n:A", "n:B", "after")).toEqual({ kind: "reorder", position: 2, index: 1, count: 3 });
  expect(dropPlacement(siblings, "n:C", "n:B", "before")).toEqual({ kind: "reorder", position: 2, index: 1, count: 3 });
});

it("moves into another folder before a child, and appends when dropped on the folder", () => {
  const items = [doc("A", 0), folder("F", 1), doc("D", 0, "n:F")];
  expect(dropPlacement(items, "n:A", "n:D", "before")).toEqual({ kind: "move", parentId: "n:F", position: 0, index: 0, count: 2 });
  expect(dropPlacement(items, "n:A", "n:F", "into")).toEqual({ kind: "move", parentId: "n:F", index: 1, count: 2 });
});

it("appends into the folder it is already in as a same-parent reorder", () => {
  const items = [doc("A", 0), folder("F", 1), doc("D", 0, "n:F")];
  expect(dropPlacement(items, "n:D", "n:F", "into")).toEqual({ kind: "reorder", position: Number.MAX_SAFE_INTEGER, index: 0, count: 1 });
});

it("refuses a folder into its own subtree, an archived container, and an anchor under an archived folder", () => {
  expect(dropPlacement([folder("F", 0), folder("G", 0, "n:F")], "n:F", "n:G", "into")).toBeNull();
  expect(dropPlacement([doc("A", 0), folder("H", 1, null, "ARCHIVED")], "n:A", "n:H", "into")).toBeNull();
  expect(dropPlacement([folder("H", 0, null, "ARCHIVED"), doc("D", 0, "n:H"), doc("A", 1)], "n:A", "n:D", "before")).toBeNull();
});

it("refuses itself and a document as a container", () => {
  expect(dropPlacement(siblings, "n:A", "n:A", "after")).toBeNull();
  expect(dropPlacement(siblings, "n:A", "n:B", "into")).toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/tree-drag-placement.test.ts`
Expected: FAIL — `dropPlacement` is not exported.

- [ ] **Step 3: Implement `dropPlacement`**

Rules, in `src/lib/knowledge-navigation.ts`:

1. Find `dragged` and `target`; either missing → `null`; `target.id === dragged.id` → `null`.
2. `const destinations = moveDestinations(items, draggedId).map(d => d.id)`.
3. `destinationParent = zone === "into" ? target.id : target.parentId`; if it is not `null` and not in `destinations` → `null` (this refuses archived containers, anchors under archived folders, and the dragged subtree).
4. If `zone === "into"` and `target.type !== "folder"` → `null`.
5. `const siblings = items.filter(i => i.parentId === destinationParent && i.id !== draggedId).sort(byPosition)`.
6. `into`: `index = siblings.length`; `count = siblings.length + 1`; if `destinationParent === dragged.parentId` return `{ kind: "reorder", position: Number.MAX_SAFE_INTEGER, index, count }`, else `{ kind: "move", parentId: destinationParent, index, count }`.
7. `before`/`after`: `at = siblings.findIndex(i => i.id === target.id)`; `at < 0` → `null`; `index = zone === "before" ? at : at + 1`; `count = siblings.length + 1`; `draggedBefore = dragged.parentId === destinationParent && dragged.position < target.position`; `position = zone === "before" ? target.position - (draggedBefore ? 1 : 0) : target.position + 1 - (draggedBefore ? 1 : 0)`; return `reorder` when the parent is unchanged, otherwise `move` with `position`.

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npx vitest run --config vitest.config.ts tests/unit/tree-drag-placement.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the real-service integration test**

In `tests/integration/organize-api.test.ts`, import `dropPlacement` beside `reorderStep`, and add two cases after the existing randomized keyboard test:

```ts
describe("the place a drop asks for, against the real service", () => {
  it("lands where the pointer drew it, with an archived sibling hidden", async () => {
    const w = await world();
    const docs: Record<string, string> = {};
    for (const title of ["A", "B", "C", "D"]) docs[title] = (await makeDocument(w, title)).documentId;
    await hub.archiveDocument(w.owner, docs.B);
    const nodes: Record<string, string> = {};
    for (const title of ["A", "C", "D"]) nodes[title] = await nodeOf(w, docs[title].documentId);
    const model = ["A", "C", "D"];
    let state = 11; // mulberry32 as above
    // 40 rounds: pick dragged and target from `model`, pick before/after,
    // placement = dropPlacement(view, nodes[dragged], nodes[target], zone);
    // assert kind "reorder"; splice `model`; PATCH placement.position; assert listTree order equals model.
    // No moves counter: unlike the keyboard test there is no edge path to bounce off — every round applies.
  });

  it("moves a document between a folder's children", async () => {
    const { w, a, d, folder } = await arranged();
    as(w.owner);
    const view = await queries.listTree(w.owner, w.notes);
    const placement = dropPlacement(view, await nodeOf(w, a.documentId), await nodeOf(w, d.documentId), "before");
    expect(placement).toMatchObject({ kind: "move", parentId: folder, position: 0 });
    expect((await patchTreeNode(request({ parentId: folder, position: 0 }, "PATCH"), ofNode(await nodeOf(w, a.documentId)))).status).toBe(204);
    expect(await order(w, w.notes, folder)).toEqual([{ label: "A", position: 0 }, { label: "D", position: 1 }]);
  });
});
```

- [ ] **Step 6: Run the integration test**

Run: `npx tsx scripts/test/integration.ts tests/integration/organize-api.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/knowledge-navigation.ts tests/unit/tree-drag-placement.test.ts tests/integration/organize-api.test.ts
git commit -m "feat(knowledge): translate a tree drop into a reorder or a move"
```

---

### Task 2: The move request and the words

**Files:**
- Modify: `src/components/knowledge/use-tree-mutations.ts`
- Modify: `src/components/knowledge/organize-messages.ts`
- Modify: `src/components/actions/action-menu.tsx:243-254`
- Modify: `src/components/knowledge/knowledge-tree.tsx:23-52`
- Modify: `src/components/knowledge/source-sidebar.tsx` (the `onReorder` wiring at ~397)
- Modify: `tests/unit/organize-messages.test.ts`
- Create: `tests/unit/use-tree-mutations-move.test.tsx`
- Modify: `tests/unit/knowledge-tree-reorder.test.tsx`, `tests/unit/knowledge-tree-row-keys.test.tsx`, `tests/unit/share-reminders-ui.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type MoveNodeInput = {
    nodeId: string;
    label: string;
    from: { parentId: string | null; position: number };
    to: { parentId: string | null; label: string | null; position?: number };
  };
  moveNode(input: MoveNodeInput, report?: "dialog" | "toast"): Promise<OrganizeResult>;
  export function placedNode(name: string, index: number, count: number): string;
  ```
- `KnowledgeTreeProps.onMove: (input: MoveNodeInput) => Promise<boolean>`; the sidebar passes `async (input) => (await mutations.moveNode(input, "toast")).ok`. Do not destructure `onMove` in `KnowledgeTree` yet — Task 3 consumes it, and an unused binding fails lint.
- `TreeMutations.moveNode` is `(input: MoveNodeInput, report?: "dialog" | "toast") => Promise<OrganizeResult>`.
- `RowProps` gains `draggable?: boolean`, `"data-row-node-id"?: string`, `onDragStart?`, `onDragOver?`, `onDrop?`, `onDragEnd?` (React drag handlers).

- [ ] **Step 1: Write the failing message test**

Add to `tests/unit/organize-messages.test.ts`:

```ts
it("says where a dropped row landed, counting from one", () => {
  expect(placedNode("Runbook", 2, 7)).toBe("Placed “Runbook”. Position 3 of 7.");
  expect(placedNode('He said "hi"', 0, 1)).toBe('Placed “He said "hi"”. Position 1 of 1.');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/organize-messages.test.ts`
Expected: FAIL — `placedNode` is not exported.

- [ ] **Step 3: Implement `placedNode`**

In `organize-messages.ts`, beside `reorderedNode`:

```ts
export const placedNode = (name: string, index: number, count: number) =>
  `Placed ${quote(name)}. Position ${index + 1} of ${count}.`;
```

- [ ] **Step 4: Write the failing mutation test**

Create `tests/unit/use-tree-mutations-move.test.tsx` (`// @vitest-environment jsdom`). Mock `next/navigation` (`useRouter` → `{ refresh: vi.fn() }`, `usePathname` → `/w/w1/knowledge/s1/d1`, `useParams` → `{ workspaceId: "w1" }`), `@/components/ui/toast` (capture the request), and `@/components/workspaces/governance-error` (a `governanceRequest` spy that resolves or rejects, and `governanceFailure` returning the error's `message`). Render a harness that exposes `useTreeMutations()` on `globalThis`, then:

```ts
it("sends the destination position when there is one, and omits it when there is not", async () => {
  await move({ nodeId: "n1", label: "B", from: { parentId: null, position: 0 }, to: { parentId: "f1", label: "F", position: 2 } });
  expect(request).toHaveBeenCalledWith("/api/tree-nodes/n1", "PATCH", { parentId: "f1", position: 2 });
  await move({ nodeId: "n1", label: "B", from: { parentId: null, position: 0 }, to: { parentId: "f1", label: "F" } });
  expect(request).toHaveBeenLastCalledWith("/api/tree-nodes/n1", "PATCH", { parentId: "f1" });
});

it("toasts a refusal only when the drag surface asks it to", async () => {
  request.mockRejectedValueOnce(new Error("no"));
  expect(await move(input, "dialog")).toEqual({ ok: false, message: "no" });
  expect(toast).not.toHaveBeenCalled();
  request.mockRejectedValueOnce(new Error("no"));
  expect(await move(input, "toast")).toEqual({ ok: false, message: "no" });
  expect(toast).toHaveBeenCalledWith({ message: "no", tone: "danger" });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/use-tree-mutations-move.test.tsx`
Expected: FAIL — the second parameter and the position are ignored.

- [ ] **Step 6: Implement the mutation changes**

In `use-tree-mutations.ts`, export the `MoveNodeInput` type from the Interfaces block above (it is today's inline `moveNode` input with `position?: number` on `to`).

`moveNode(input, report = "dialog")` sends `{ parentId: to.parentId, ...(to.position !== undefined ? { position: to.position } : {}) }`; on failure, `const message = organizeFailure(governanceFailure(failure)); if (report === "toast") toast({ message, tone: "danger" }); return { ok: false, message };`. Success is unchanged (toast with Undo, refresh).

- [ ] **Step 7: Wire the type and the prop**

- `KnowledgeTreeProps` gains `onMove: (input: MoveNodeInput) => Promise<boolean>` (type-only import from `./use-tree-mutations`).
- `source-sidebar.tsx` passes `onMove={async (input) => (await mutations.moveNode(input, "toast")).ok}` beside `onReorder`.
- Add `onMove: async () => true` beside every `onReorder` in the three unit test render helpers.

- [ ] **Step 8: Run the unit tests, typecheck and lint**

Run: `npx vitest run --config vitest.config.ts tests/unit/organize-messages.test.ts tests/unit/use-tree-mutations-move.test.tsx tests/unit/knowledge-tree-reorder.test.tsx tests/unit/knowledge-tree-row-keys.test.tsx tests/unit/share-reminders-ui.test.tsx`
Then: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/knowledge/use-tree-mutations.ts src/components/knowledge/organize-messages.ts src/components/knowledge/knowledge-tree.tsx src/components/knowledge/source-sidebar.tsx src/components/actions/action-menu.tsx tests/unit
git commit -m "feat(knowledge): carry a drop's destination and words"
```

---

### Task 3: The drag interaction

**Files:**
- Create: `src/components/knowledge/use-tree-drag.ts`
- Modify: `src/components/knowledge/knowledge-tree.tsx` (rows, indicator, hook)
- Modify: `src/app/globals.css` (after `.kh-block-drop-line`, and the print rule)
- Modify: `docs/superpowers/specs/frontend-design-language.md` (one paragraph beside the explorer rules)
- Create: `tests/unit/knowledge-tree-drag.test.tsx`

**Interfaces:**
- Consumes: `dropPlacement` (Task 1), `MoveNodeInput` and `onMove` (Task 2), `placedNode` (Task 2), `CLEAR_FILTER_TO_REORDER`, `expandFrom`, `collapsedIds`, `announce`, `treeRef`.
- Produces:
  ```ts
  export type TreeDragIndicator =
    | { kind: "line"; top: number; left: number; width: number }
    | { kind: "into"; nodeId: string }
    | null;

  export function useTreeDrag(input: {
    items: KnowledgeTreeItem[];
    filtering: boolean;
    canMove: (nodeId: string) => boolean;
    isCollapsed: (nodeId: string) => boolean;
    onReorder: (input: { nodeId: string; position: number }) => Promise<boolean>;
    onMove: (input: MoveNodeInput) => Promise<boolean>;
    onPlaced: (nodeId: string, parentId: string | null) => void;
    announce: (text: string) => void;
    expandFolder: (folderId: string) => void;
    treeRef: React.RefObject<HTMLUListElement | null>;
  }): {
    rowProps: (nodeId: string) => {
      draggable: boolean;
      "data-row-node-id": string;
      onDragStart: (event: React.DragEvent<HTMLElement>) => void;
      onDragOver: (event: React.DragEvent<HTMLElement>) => void;
      onDrop: (event: React.DragEvent<HTMLElement>) => void;
      onDragEnd: () => void;
    };
    indicator: TreeDragIndicator;
    draggingId: string | null;
  };
  ```

- [ ] **Step 1: Write the failing jsdom test**

Create `tests/unit/knowledge-tree-drag.test.tsx` using the same harness as `knowledge-tree-reorder.test.tsx` (mock `next/navigation`, `next/link`, stub `window.matchMedia` to `{ matches: true }`). Cases:

```ts
it("offers a drag only where the registry offers Move", async () => {
  render(); // documentActions returns [document.move]
  expect(rowFor("A")).toHaveAttribute("draggable", "true");
  render({ documentActions: () => [] });
  expect(rowFor("A")).toHaveAttribute("draggable", "false");
  render({ items: [{ ...doc("A", 0), status: "ARCHIVED" }] });
  expect(rowFor("A")).toHaveAttribute("draggable", "false");
});

it("cancels a filtered drag and says why", async () => {
  render({ query: "A" });
  const event = new Event("dragstart", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { effectAllowed: "", setData: vi.fn() } });
  await act(async () => { rowFor("A").dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(said()).toContain("Clear the filter to reorder.");
  expect(rowFor("A").className).not.toContain("kh-tree-drag-source");
});

it("ignores a second drop while the first request is in flight", async () => {
  // stub getBoundingClientRect on B (top 0, height 20, left 0, width 100);
  // onReorder returns a promise resolved by the test;
  // dragstart A, dragover B at clientY 1, drop B; then dragstart C, dragover B, drop B.
  expect(onReorder).toHaveBeenCalledTimes(1);
  resolve(); // then await act
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/knowledge-tree-drag.test.tsx`
Expected: FAIL — no `data-row-node-id` / drag handlers.

- [ ] **Step 3: Implement the hook**

`use-tree-drag.ts` (`"use client"`), constants `AUTO_EXPAND_MS = 500`, `EDGE = 24`, `SCROLL_STEP = 12`, `FINE_POINTER = "(hover: hover) and (pointer: fine)"`:

- `enabled` starts `false`, set from `window.matchMedia(FINE_POINTER).matches` in an effect.
- `draggingId` / `indicator` state; `draggingRef`, `busyRef`, `pointerYRef`, `frameRef`, `expandTimerRef`, `expandForRef`.
- `rowProps(nodeId)`: `draggable: enabled && canMove(nodeId)`; `data-row-node-id: nodeId`; handlers below.
- `onDragStart`: `canMove` false or `filtering` → `event.preventDefault()`, and when filtering `announce(CLEAR_FILTER_TO_REORDER)`; otherwise `dataTransfer.effectAllowed = "move"`, `setData("application/x-kh-tree-node", nodeId)`, set `draggingId`, start the scroll frame.
- `onDragOver`: `preventDefault()`; `dropEffect = "move"`; zone from `event.clientY` against `currentTarget.getBoundingClientRect()` (folder: `<0.25` before, `>0.75` after, else into; archived folder: half; document: half); `placement = dropPlacement(items, draggedId, nodeId, zone)`; `null` → clear indicator and timers; `into` → `{kind:"into", nodeId}` and start the 500 ms expand timer when `isCollapsed(nodeId)`; before/after → `{kind:"line", top, left, width}` where `top` is the header's top or bottom, except a folder's "after" uses `currentTarget.closest("[data-node-id]").getBoundingClientRect().bottom`; record `pointerYRef`.
- `onDrop`: if `busyRef` or no drag → return; `preventDefault()`; recompute the placement from the pointer position and zone; `null` → cleanup; set `busyRef`; for `reorder` call `onReorder({nodeId, position})` and on `true` `announce(placedNode(label, index, count))`; for `move` call `onMove({nodeId, label, from, to: {parentId, label: folder label or null, position}})`; on `true` `onPlaced(nodeId, parentId)`. Cleanup in `finally` (indicator, timers, `busyRef` after the promise settles; a 3 s give-up timer clears `busyRef` if the promise never settles, and is cleared when it does).
- `onDragEnd`: cleanup (indicator, timers, frame, `draggingId`).
- Scroll frame: while dragging, if `pointerYRef` is within `EDGE` of the scroller's top/bottom, `scroller.scrollTop += SCROLL_STEP`; `scroller = treeRef.current?.closest("nav")`.
- Effect cleanup on unmount cancels the frame and timer.

- [ ] **Step 4: Wire the tree and the styles**

- Call `useTreeDrag` in `KnowledgeTree` with `items`, `query.trim() !== ""`, a `canMove` built from `documentActions`/`folderActions` (`.some(a => a.id === "document.move" || a.id === "folder.move")`), `collapsedIds`, the existing `onReorder`, the new `onMove`, `onPlaced` (set `focusAfterReorder.current` and `expandFrom(parentId)` when not null), `announce`, `expandFrom`, `treeRef`.
- Document row: spread `{...drag.rowProps(item.id)}` on the `RowContextMenu`; add `kh-tree-drag-source` when `drag.draggingId === item.id`; set `draggable={false}` on the row's `<Link>` so the browser does not start a native link drag.
- Folder row: spread `{...drag.rowProps(item.id)}` on the header `RowContextMenu as="div"`; add `kh-tree-drag-source` and `kh-tree-drop-into` (when `indicator.kind === "into" && indicator.nodeId === item.id`) to that div's class.
- Render the line before the `<ul>`: `{drag.indicator?.kind === "line" ? <div className="kh-tree-drop-line" aria-hidden="true" style={{ top, left, width }} /> : null}`.
- `globals.css`: `.kh-tree-drop-line { position: fixed; z-index: 50; height: 2px; background: var(--kh-primary); pointer-events: none; }`, `.kh-tree-drag-source { background-color: var(--kh-bg-selected); }`, `.kh-tree-drop-into { background-color: var(--kh-bg-selected); }`; add `.kh-tree-drop-line` to the print rule that hides `.kh-block-drop-line`.
- Design language: one paragraph stating whole-row drag, the tint and 2px line (line below the subtree for "after a folder"), the 500 ms expand, and no drag on a source the Hub cannot write to; no new token.

- [ ] **Step 5: Run the jsdom test and the full gate**

Run: `npx vitest run --config vitest.config.ts tests/unit/knowledge-tree-drag.test.tsx`
Then: `make verify`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/knowledge/use-tree-drag.ts src/components/knowledge/knowledge-tree.tsx src/app/globals.css docs/superpowers/specs/frontend-design-language.md tests/unit/knowledge-tree-drag.test.tsx
git commit -m "feat(knowledge): drag tree rows to arrange them"
```

---

### Task 4: Browser proof

**Files:**
- Create: `tests/e2e/zz-tree-drag.spec.ts`

**Interfaces:**
- Consumes: `ROUND_TRIP`, `mySpace`, `openKnowledge`, `row`, `header`, `childrenOf`, `toast`, `unique` from `tests/e2e/fixtures/organize.ts`; the API helpers `apiDocument` / `apiFolder` / `countTreeRequests` copied from `zz-organize-move.spec.ts`.

- [ ] **Step 1: Write the E2E spec**

`test.describe("dragging rows @tree-drag", …)`. Each test creates its folders and documents through the API **before** `openKnowledge`, so the first render already has them; work inside one folder so the order is deterministic (the root also holds the seed document `openKnowledge` creates). Shared setup:

```ts
const workspaceId = await mySpace(page);
const guides = unique("Guides");
const folderId = await apiFolder(page, workspaceId, guides);
await apiDocument(page, workspaceId, "A", folderId);
await apiDocument(page, workspaceId, "B", folderId);
await apiDocument(page, workspaceId, "C", folderId);
await openKnowledge(page, workspaceId);
// Folders are expanded by default; nothing to click.
await expect(row(page, guides)).toHaveAttribute("aria-expanded", "true", ROUND_TRIP);
```

Cases:

1. **Reorder:** `row("C").dragTo(row("B"), { targetPosition: { x: 20, y: 2 } })`; poll `childrenOf(row(guides))` to `["A", "C", "B"]`; `countTreeRequests` is 1.
2. **Into a folder, with Undo:** create G inside `guides` before opening; drag B onto `header("G")` at `{ x: 20, y: height / 2 }`; expect `childrenOf(row("G"))` to be `["B"]` and `childrenOf(row(guides))` to lose B; click the toast's Undo; expect B back in `guides`.
3. **Folder above folder:** create G and H inside `guides` before opening; drag `header("H")` above `header("G")` at `{ x: 20, y: 2 }`; expect H before G.
4. **Below an expanded folder:** create G with B inside before opening; drag A to `header("G")` at `{ x: 20, y: height - 2 }`; expect A after G in `childrenOf(row(guides))` and `childrenOf(row("G"))` unchanged.
5. **Auto-expand without dropping:** create G before opening; after opening, collapse it (`header("G").click()`, then expect `aria-expanded="false"`); `page.mouse.move` to A, `down()`, `move` to `header("G")` centre in steps, wait 700 ms, expect `row("G")` to have `aria-expanded="true"`; press Escape, then `up()`; assert no PATCH was sent.
6. **A click still opens:** click `row("A")`; expect the document content region to be visible.
7. **Synced source has no drag:** `page.goto("/w/0199f100-0000-7000-8000-000000000001/knowledge/0199f100-0000-7000-8000-000000000101")`; open "Vendor Compliance Vault" if closed; assert `row(page, "Compliance Policy")` has `draggable="false"`.

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/test/e2e.ts --grep @tree-drag`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/zz-tree-drag.spec.ts
git commit -m "test(knowledge): prove tree dragging in the browser"
```
