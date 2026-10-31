// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
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
function render(props: Props = {}) {
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
  act(() => root.render(element({})));
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
    const fire = (row: HTMLElement, type: string, y = 1) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { dataTransfer: { value: transfer }, clientY: { value: y } });
      row.dispatchEvent(event);
    };
    act(() => { fire(rowFor("A"), "dragstart"); fire(target, "dragover"); fire(target, "drop"); });
    expect(onReorder).toHaveBeenCalledWith({ nodeId: "n:A", position: 0 });
    act(() => { fire(rowFor("C"), "dragstart"); fire(target, "dragover"); fire(target, "drop"); });
    expect(onReorder).toHaveBeenCalledTimes(1);
    await act(async () => { finish(true); });
    act(() => { fire(rowFor("C"), "dragstart"); fire(target, "dragover"); fire(target, "drop"); });
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(said()).toContain("Placed “A”. Position 1 of 3.");
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
});
