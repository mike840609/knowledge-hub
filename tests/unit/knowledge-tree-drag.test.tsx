// @vitest-environment jsdom
import { act, createElement, Profiler, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgeTree } from "@/components/knowledge/knowledge-tree";
import type { Action } from "@/components/actions/action-registry";
import type { KnowledgeTreeItem } from "@/modules/knowledge/application/knowledge-query-service";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
// A link outside a mounted app router has nothing to route through; the tree only needs an anchor.
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return {
    default: ({ href, children, prefetch, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => {
      void prefetch; // a router's business, and not an attribute of an anchor
      return h("a", { href, ...rest }, children);
    },
  };
});

/**
 * What the tree does with Alt+↑/↓ (daily-driver spec §7.3), without a browser: which rows it acts on,
 * what place it asks for, and what it does not do. The browser run (zz-organize-move.spec.ts) holds
 * the whole path against a server; the things here are the ones it cannot easily reach — a row that
 * may not be moved needs a source with two documents the Hub does not own, which the fixtures lack.
 */

const doc = (label: string, position: number, parentId: string | null = null): KnowledgeTreeItem => ({
  type: "document", id: `n:${label}`, parentId, documentId: `d:${label}`, label, currentRevisionId: `r:${label}`, position, status: "ACTIVE",
});
const items = [doc("A", 0), doc("B", 1), doc("C", 2)];

const moveAction = (id: "document.move" | "folder.move"): Action => ({
  id, label: "Move…", group: "document", icon: "move", keywords: [], surfaces: ["row"],
  effect: { kind: "move", sourceId: "s1", label: "x", node: { type: "document", documentId: "d:x" } },
});

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.localStorage.clear();
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

type Props = Partial<ComponentProps<typeof KnowledgeTree>>;
function render(props: Props = {}, onRender?: () => void) {
  const onReorder = props.onReorder ?? vi.fn(async () => true);
  const element = (extra: Props) =>
    createElement(KnowledgeTree, {
      items,
      workspaceId: "w1",
      sourceId: "s1",
      favoriteDocumentIds: new Set<string>(),
      onToggleFavorite: () => {},
      documentActions: () => [moveAction("document.move")],
      folderActions: () => [],
      onRunAction: () => {},
      onReorder,
      onMove: async () => true,
      ...props,
      ...extra,
    });
  act(() => root.render(onRender ? createElement(Profiler, { id: "tree", onRender }, element({})) : element({})));
  return { onReorder, rerender: (extra: Props) => act(() => root.render(element(extra))) };
}

const rowFor = (label: string) => container.querySelector<HTMLElement>(`[role=treeitem][aria-label="${label}"]`)!;
const said = () => container.querySelector('[aria-live="polite"]')?.textContent ?? "";

describe("tree dragging", () => {
  it("offers drag only to movable rows", () => {
    const { rerender } = render();
    expect(rowFor("A").getAttribute("draggable")).toBe("true");
    rerender({ documentActions: () => [] });
    expect(rowFor("A").getAttribute("draggable")).toBe("false");
    rerender({ items: [{ ...doc("A", 0), status: "ARCHIVED" }] });
    expect(rowFor("A").getAttribute("draggable")).toBe("false");
  });
  it("cancels a filtered drag and explains why", () => {
    render({ query: "A" });
    const event = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { effectAllowed: "", setData: vi.fn() } });
    act(() => { rowFor("A").dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(said()).toContain("Clear the filter to reorder.");
  });
  it("sends one reorder and ignores another drop while it is pending", async () => {
    let finish: (value: boolean) => void = () => {};
    const onReorder = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    render({ onReorder });
    const target = rowFor("B");
    target.getBoundingClientRect = () => ({ top: 0, bottom: 20, height: 20, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    const transfer = { effectAllowed: "", dropEffect: "", setData: vi.fn() };
    const fire = (row: HTMLElement, type: string, y = 19) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { dataTransfer: { value: transfer }, clientY: { value: y } });
      row.dispatchEvent(event);
    };
    act(() => { fire(rowFor("A"), "dragstart"); fire(target, "dragover"); fire(target, "drop"); });
    expect(onReorder).toHaveBeenCalledWith({ nodeId: "n:A", position: 1 });
    act(() => { fire(rowFor("C"), "dragstart"); fire(target, "dragover"); fire(target, "drop"); });
    expect(onReorder).toHaveBeenCalledTimes(1);
    await act(async () => { finish(true); });
    act(() => { fire(rowFor("C"), "dragstart"); fire(target, "dragover"); fire(target, "drop"); });
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(said()).toContain("Placed “A”. Position 2 of 3.");
  });
  it("clears the drop marker when the pointer leaves the row", () => {
    render();
    const target = rowFor("B");
    target.getBoundingClientRect = () => ({ top: 0, bottom: 20, height: 20, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    const transfer = { effectAllowed: "", dropEffect: "", setData: vi.fn() };
    const fire = (row: HTMLElement, type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { dataTransfer: { value: transfer }, clientY: { value: 1 }, relatedTarget: { value: document.body } });
      row.dispatchEvent(event);
    };
    act(() => { fire(rowFor("A"), "dragstart"); fire(target, "dragover"); });
    expect(container.querySelector(".kh-tree-drop-line")).not.toBeNull();
    act(() => { fire(target, "dragleave"); });
    expect(container.querySelector(".kh-tree-drop-line")).toBeNull();
  });
  it("restores focus when the refreshed tree arrives before the request resolves", async () => {
    let finish: (value: boolean) => void = () => {};
    const onReorder = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const { rerender } = render({ onReorder });
    const target = rowFor("B");
    target.getBoundingClientRect = () => ({ top: 0, bottom: 20, height: 20, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    const transfer = { effectAllowed: "", dropEffect: "", setData: vi.fn() };
    const fire = (row: HTMLElement, type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { dataTransfer: { value: transfer }, clientY: { value: 19 } });
      row.dispatchEvent(event);
    };
    act(() => { fire(rowFor("A"), "dragstart"); fire(target, "drop"); });
    rerender({ items: [doc("B", 0), doc("A", 1), doc("C", 2)] });
    await act(async () => { finish(true); });
    expect(document.activeElement).toBe(rowFor("A"));
  });
  it("restores keyboard focus when the refreshed tree arrives before the reorder response", async () => {
    let finish: (value: boolean) => void = () => {};
    const onReorder = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const { rerender } = render({ onReorder });
    act(() => { rowFor("B").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true, cancelable: true })); });
    // The refreshed tree lands while the PATCH is still unresolved; focus must follow the row now,
    // not wait for a promise whose effect will never run again.
    rerender({ items: [doc("A", 0), doc("C", 1), doc("B", 2)] });
    expect(document.activeElement).toBe(rowFor("B"));
    await act(async () => { finish(true); });
    expect(document.activeElement).toBe(rowFor("B"));
  });
  it("focuses a moved row after its collapsed destination opens", async () => {
    let finish: (value: boolean) => void = () => {};
    const onMove = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const folder: KnowledgeTreeItem = { type: "folder", id: "n:F", parentId: null, label: "F", position: 1, status: "ACTIVE" };
    const { rerender } = render({ items: [doc("A", 0), folder], onMove, folderActions: () => [moveAction("folder.move")] });
    act(() => { rowFor("F").querySelector("button")!.click(); });
    const target = rowFor("F").querySelector<HTMLElement>("[data-row-node-id]")!;
    target.getBoundingClientRect = () => ({ top: 0, bottom: 20, height: 20, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    const fire = (row: HTMLElement, type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { dataTransfer: { value: { effectAllowed: "", setData: vi.fn() } }, clientY: { value: 10 } });
      row.dispatchEvent(event);
    };
    act(() => { fire(rowFor("A"), "dragstart"); fire(target, "drop"); });
    rerender({ items: [folder, doc("A", 0, "n:F")] });
    await act(async () => { finish(true); });
    expect(document.activeElement).toBe(rowFor("A"));
  });
  it("refuses a new drag while a request is unresolved, and still reports the slow success", async () => {
    vi.useFakeTimers();
    try {
      let finish: (value: boolean) => void = () => {};
      const onReorder = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
      render({ onReorder });
      const target = rowFor("B");
      target.getBoundingClientRect = () => ({ top: 0, bottom: 20, height: 20, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
      const transfer = { effectAllowed: "", dropEffect: "", setData: vi.fn() };
      const fire = (row: HTMLElement, type: string, y = 1) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, { dataTransfer: { value: transfer }, clientY: { value: y } });
        row.dispatchEvent(event);
        return event;
      };
      act(() => { fire(rowFor("A"), "dragstart"); fire(target, "drop", 19); });
      // A UI timeout is not a completed write: the next drag must stay refused while the PATCH is
      // unresolved, or a late first PATCH could commit after the second and overwrite it.
      let second: Event | undefined;
      act(() => { vi.advanceTimersByTime(3000); second = fire(rowFor("C"), "dragstart"); });
      expect(second?.defaultPrevented).toBe(true);
      expect(rowFor("C").className).not.toContain("kh-tree-drag-source");
      await act(async () => { finish(true); });
      expect(onReorder).toHaveBeenCalledTimes(1);
      expect(said()).toContain("Placed “A”. Position 2 of 3.");
    } finally { vi.useRealTimers(); }
  });
  it("does not mistake another row changing for the drop refresh", async () => {
    let finish: (value: boolean) => void = () => {};
    const onReorder = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const { rerender } = render({ onReorder });
    const target = rowFor("B");
    target.getBoundingClientRect = () => ({ top: 0, bottom: 20, height: 20, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    const fire = (row: HTMLElement, type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { dataTransfer: { value: { effectAllowed: "", setData: vi.fn() } }, clientY: { value: 19 } });
      row.dispatchEvent(event);
    };
    act(() => { fire(rowFor("A"), "dragstart"); fire(target, "drop"); });
    rerender({ items: items.map(item => ({ ...item })) });
    rerender({ items: [doc("A", 0), doc("B", 1), doc("C", 3)] });
    await act(async () => { finish(true); });
    act(() => { fire(rowFor("C"), "dragstart"); fire(target, "drop"); });
    expect(onReorder).toHaveBeenCalledTimes(1);
  });
  it("does not allow keyboard reorder while a drag request is pending", () => {
    const onReorder = vi.fn(() => new Promise<boolean>(() => {}));
    render({ onReorder });
    const target = rowFor("B");
    target.getBoundingClientRect = () => ({ top: 0, bottom: 20, height: 20, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    const fire = (row: HTMLElement, type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { dataTransfer: { value: { effectAllowed: "", setData: vi.fn() } }, clientY: { value: 19 } });
      row.dispatchEvent(event);
    };
    act(() => { fire(rowFor("A"), "dragstart"); fire(target, "drop"); });
    act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true, cancelable: true })); });
    expect(onReorder).toHaveBeenCalledTimes(1);
  });
  it("does not start a drag while a keyboard reorder is pending", () => {
    const onReorder = vi.fn(() => new Promise<boolean>(() => {}));
    render({ onReorder });
    const target = rowFor("B");
    act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true, cancelable: true })); });
    const event = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { effectAllowed: "", setData: vi.fn() } });
    act(() => { rowFor("A").dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
  });
  it("keeps a keyboard reorder locked when the tree rerenders unchanged", () => {
    const onReorder = vi.fn(() => new Promise<boolean>(() => {}));
    const { rerender } = render({ onReorder });
    act(() => { rowFor("B").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true, cancelable: true })); });
    rerender({ items: items.map(item => ({ ...item })) });
    const event = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { effectAllowed: "", setData: vi.fn() } });
    act(() => { rowFor("A").dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
  });
  it("ignores an old keyboard refusal after a queued newer request starts", async () => {
    let finishFirst: (value: boolean) => void = () => {};
    const onReorder = vi.fn()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => { finishFirst = resolve; }))
      .mockImplementation(() => new Promise<boolean>(() => {}));
    const { rerender } = render({ onReorder });
    const press = (label: string, key: string) => rowFor(label).dispatchEvent(new KeyboardEvent("keydown", { key, altKey: true, bubbles: true, cancelable: true }));
    act(() => { press("B", "ArrowDown"); press("C", "ArrowUp"); });
    // The second key is queued behind the unresolved request, not sent on top of it.
    expect(onReorder).toHaveBeenCalledTimes(1);
    rerender({ items: [doc("A", 0), doc("C", 1), doc("B", 2)] });
    expect(onReorder).toHaveBeenCalledTimes(2);
    expect(onReorder).toHaveBeenLastCalledWith({ nodeId: "n:C", position: 0 });
    await act(async () => { finishFirst(false); });
    const event = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { effectAllowed: "", setData: vi.fn() } });
    act(() => { rowFor("A").dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
  });
  it("blocks keyboard sorting during an active drag", async () => {
    const onReorder = vi.fn(async () => true);
    render({ onReorder });
    const target = rowFor("B");
    target.getBoundingClientRect = () => ({ top: 0, bottom: 20, height: 20, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    const fire = (row: HTMLElement, type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { dataTransfer: { value: { effectAllowed: "", setData: vi.fn() } }, clientY: { value: 19 } });
      row.dispatchEvent(event);
    };
    await act(async () => { fire(rowFor("A"), "dragstart"); target.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true, cancelable: true })); fire(target, "drop"); });
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith({ nodeId: "n:A", position: 1 });
  });
  it("announces a slow successful drop when no newer operation has started", async () => {
    vi.useFakeTimers();
    try {
      let finish: (value: boolean) => void = () => {};
      render({ onReorder: () => new Promise<boolean>((resolve) => { finish = resolve; }) });
      const target = rowFor("B");
      target.getBoundingClientRect = () => ({ top: 0, bottom: 20, height: 20, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
      const fire = (row: HTMLElement, type: string) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, { dataTransfer: { value: { effectAllowed: "", setData: vi.fn() } }, clientY: { value: 19 } });
        row.dispatchEvent(event);
      };
      act(() => { fire(rowFor("A"), "dragstart"); fire(target, "drop"); vi.advanceTimersByTime(3000); });
      await act(async () => { finish(true); });
      expect(said()).toContain("Placed “A”. Position 2 of 3.");
    } finally { vi.useRealTimers(); }
  });
  it("announces a slow successful keyboard reorder when no newer operation has started", async () => {
    vi.useFakeTimers();
    try {
      let finish: (value: boolean) => void = () => {};
      render({ onReorder: () => new Promise<boolean>((resolve) => { finish = resolve; }) });
      act(() => { rowFor("B").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true, cancelable: true })); vi.advanceTimersByTime(3000); });
      await act(async () => { finish(true); });
      expect(said()).toContain("Moved “B” down. Position 3 of 3.");
    } finally { vi.useRealTimers(); }
  });
  it("restores focus after the refreshed tree arrives following a move response", async () => {
    let finish: (value: boolean) => void = () => {};
    const folder: KnowledgeTreeItem = { type: "folder", id: "n:F", parentId: null, label: "F", position: 1, status: "ACTIVE" };
    const { rerender } = render({ items: [doc("A", 0), folder], onMove: () => new Promise<boolean>((resolve) => { finish = resolve; }), folderActions: () => [moveAction("folder.move")] });
    act(() => { rowFor("F").querySelector("button")!.click(); });
    const target = rowFor("F").querySelector<HTMLElement>("[data-row-node-id]")!;
    target.getBoundingClientRect = () => ({ top: 0, bottom: 20, height: 20, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    const fire = (row: HTMLElement, type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { dataTransfer: { value: { effectAllowed: "", setData: vi.fn() } }, clientY: { value: 10 } });
      row.dispatchEvent(event);
    };
    act(() => { fire(rowFor("A"), "dragstart"); fire(target, "drop"); });
    await act(async () => { finish(true); });
    rerender({ items: [folder, doc("A", 0, "n:F")] });
    expect(document.activeElement).toBe(rowFor("A"));
  });
  it("ignores a late keyboard reply after a refresh starts the queued step", async () => {
    let finishFirst: (value: boolean) => void = () => {};
    const onReorder = vi.fn()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => { finishFirst = resolve; }))
      .mockImplementation(() => new Promise<boolean>(() => {}));
    const { rerender } = render({ onReorder });
    const press = (key: string) => rowFor("B").dispatchEvent(new KeyboardEvent("keydown", { key, altKey: true, bubbles: true, cancelable: true }));
    act(() => { press("ArrowDown"); press("ArrowUp"); });
    rerender({ items: [doc("A", 0), doc("C", 1), doc("B", 2)] });
    expect(onReorder).toHaveBeenCalledTimes(2);
    await act(async () => { finishFirst(false); });
    const event = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { effectAllowed: "", setData: vi.fn() } });
    act(() => { rowFor("A").dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
  });
  it("does not send a request or block the next drag for an unchanged position", async () => {
    const { onReorder } = render();
    const target = rowFor("B");
    target.getBoundingClientRect = () => ({ top: 0, bottom: 20, height: 20, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    const fire = (row: HTMLElement, type: string, y: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { dataTransfer: { value: { effectAllowed: "", dropEffect: "", setData: vi.fn() } }, clientY: { value: y } });
      row.dispatchEvent(event);
      return event;
    };
    await act(async () => { fire(rowFor("A"), "dragstart", 1); fire(target, "drop", 1); });
    expect(onReorder).not.toHaveBeenCalled();
    let next: Event | undefined;
    act(() => { next = fire(rowFor("C"), "dragstart", 1); });
    expect(next?.defaultPrevented).toBe(false);
    await act(async () => { fire(target, "drop", 1); });
    expect(onReorder).toHaveBeenCalledWith({ nodeId: "n:C", position: 1 });
  });
  it("does not rerender the tree for repeated dragovers at the same location", () => {
    const onRender = vi.fn();
    render({}, onRender);
    const target = rowFor("B");
    target.getBoundingClientRect = () => ({ top: 0, bottom: 20, height: 20, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    const fire = (row: HTMLElement, type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { dataTransfer: { value: { effectAllowed: "", dropEffect: "", setData: vi.fn() } }, clientY: { value: 1 } });
      row.dispatchEvent(event);
    };
    act(() => { fire(rowFor("A"), "dragstart"); fire(target, "dragover"); });
    const count = onRender.mock.calls.length;
    act(() => { fire(target, "dragover"); });
    expect(onRender).toHaveBeenCalledTimes(count);
  });
  it("does not accept an invalid drop target", () => {
    render();
    const transfer = { effectAllowed: "", dropEffect: "move", setData: vi.fn() };
    const start = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(start, "dataTransfer", { value: transfer });
    const over = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperties(over, { dataTransfer: { value: transfer }, clientY: { value: 1 } });
    act(() => { rowFor("A").dispatchEvent(start); rowFor("A").dispatchEvent(over); });
    expect(over.defaultPrevented).toBe(false);
    expect(transfer.dropEffect).toBe("none");
  });
  it("still reorders across a hidden archived sibling", async () => {
    const { onReorder } = render({ items: [doc("A", 0), doc("B", 2)] });
    const target = rowFor("B");
    target.getBoundingClientRect = () => ({ top: 0, bottom: 20, height: 20, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    const fire = (row: HTMLElement, type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { dataTransfer: { value: { effectAllowed: "", dropEffect: "", setData: vi.fn() } }, clientY: { value: 1 } });
      row.dispatchEvent(event);
      return event;
    };
    let over: Event | undefined;
    await act(async () => { fire(rowFor("A"), "dragstart"); over = fire(target, "dragover"); fire(target, "drop"); });
    expect(over?.defaultPrevented).toBe(true);
    expect(onReorder).toHaveBeenCalledWith({ nodeId: "n:A", position: 1 });
  });
  it("does not infer an append is unchanged from visible siblings alone", async () => {
    const folder: KnowledgeTreeItem = { type: "folder", id: "n:F", parentId: null, label: "F", position: 0, status: "ACTIVE" };
    const { onReorder } = render({ items: [folder, doc("A", 0, "n:F")], folderActions: () => [moveAction("folder.move")] });
    const target = rowFor("F").querySelector<HTMLElement>("[data-row-node-id]")!;
    target.getBoundingClientRect = () => ({ top: 0, bottom: 20, height: 20, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    const fire = (row: HTMLElement, type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { dataTransfer: { value: { effectAllowed: "", setData: vi.fn() } }, clientY: { value: 10 } });
      row.dispatchEvent(event);
    };
    await act(async () => { fire(rowFor("A"), "dragstart"); fire(target, "drop"); });
    expect(onReorder).toHaveBeenCalledWith({ nodeId: "n:A", position: Number.MAX_SAFE_INTEGER });
  });
  it("unlocks after a successful no-op append and an unchanged tree refresh", async () => {
    const folder: KnowledgeTreeItem = { type: "folder", id: "n:F", parentId: null, label: "F", position: 0, status: "ACTIVE" };
    const original = [folder, doc("A", 0, "n:F"), doc("B", 1, "n:F")];
    const onReorder = vi.fn(async () => true);
    const { rerender } = render({ items: original, onReorder, folderActions: () => [moveAction("folder.move")] });
    const header = rowFor("F").querySelector<HTMLElement>("[data-row-node-id]")!;
    const next = rowFor("B");
    const bounds = { top: 0, bottom: 20, height: 20, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) };
    header.getBoundingClientRect = () => bounds;
    next.getBoundingClientRect = () => bounds;
    const fire = (element: HTMLElement, name: string, y: number) => {
      const event = new Event(name, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { dataTransfer: { value: { effectAllowed: "", setData: vi.fn() } }, clientY: { value: y } });
      element.dispatchEvent(event);
      return event;
    };
    await act(async () => { fire(next, "dragstart", 10); fire(header, "drop", 10); });
    expect(onReorder).toHaveBeenCalledWith({ nodeId: "n:B", position: Number.MAX_SAFE_INTEGER });
    // Successful append of an already-last node returns the same stored positions.
    rerender({ items: original.map((item) => ({ ...item })) });
    let start: Event | undefined;
    await act(async () => { start = fire(rowFor("A"), "dragstart", 10); fire(rowFor("B"), "drop", 19); });
    expect(start?.defaultPrevented).toBe(false);
    expect(onReorder).toHaveBeenCalledWith({ nodeId: "n:A", position: 1 });
    expect(onReorder).toHaveBeenCalledTimes(2);
  });

  it("waits for the first keyboard PATCH response before dispatching a queued reorder", async () => {
    let finishFirst!: (ok: boolean) => void;
    const onReorder = vi.fn()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => { finishFirst = resolve; }))
      .mockImplementation(async () => true);
    const { rerender } = render({ onReorder });
    act(() => {
      rowFor("B").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true, cancelable: true }));
      rowFor("B").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true, cancelable: true }));
    });
    rerender({ items: [doc("A", 0), doc("C", 1), doc("B", 2)] });
    // The matching RSC tree may arrive before the PATCH response; it is not write completion.
    expect(onReorder).toHaveBeenCalledTimes(1);
    await act(async () => { finishFirst(true); });
    expect(onReorder).toHaveBeenCalledTimes(2);
    expect(onReorder).toHaveBeenLastCalledWith({ nodeId: "n:B", position: 1 });
  });

});
