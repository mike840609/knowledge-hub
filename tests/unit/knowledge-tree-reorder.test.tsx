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
      ...props,
      ...extra,
    });
  act(() => root.render(element({})));
  return { onReorder, rerender: (extra: Props) => act(() => root.render(element(extra))) };
}

const rowFor = (label: string) => container.querySelector<HTMLElement>(`[role=treeitem][aria-label="${label}"]`)!;
const said = () => container.querySelector('[aria-live="polite"]')?.textContent ?? "";

function press(target: HTMLElement, key: string, modifiers: Partial<KeyboardEventInit> = { altKey: true }) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers });
  act(() => { target.dispatchEvent(event); });
  return event;
}

describe("Alt+arrow on a row the reader may move", () => {
  it("asks for the neighbour's place, and takes the key so nothing else answers it", () => {
    const { onReorder } = render();
    const event = press(rowFor("B"), "ArrowDown");
    expect(onReorder).toHaveBeenCalledWith({ nodeId: "n:B", position: 2 });
    expect(event.defaultPrevented).toBe(true);
  });

  it("asks for the place above it when the key is up", () => {
    const { onReorder } = render();
    press(rowFor("B"), "ArrowUp");
    expect(onReorder).toHaveBeenCalledWith({ nodeId: "n:B", position: 0 });
  });

  it("says where the row is now, counting from one, once the server has said yes", async () => {
    render();
    await act(async () => { rowFor("B").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true, cancelable: true })); });
    expect(said()).toBe("Moved “B” down. Position 3 of 3.");
  });

  it("says nothing of having moved when the server said no", async () => {
    render({ onReorder: vi.fn(async () => false) });
    await act(async () => { rowFor("B").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true, cancelable: true })); });
    expect(said()).toBe("");
  });

  it("says it is at an edge, and asks nothing of the server", () => {
    const { onReorder } = render();
    press(rowFor("A"), "ArrowUp");
    expect(said()).toBe("“A” is already first.");
    press(rowFor("C"), "ArrowDown");
    expect(said()).toBe("“C” is already last.");
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("ignores every other combination, so Alt+Shift, Ctrl+Alt and ⌘+Alt are not a reorder", () => {
    const { onReorder } = render();
    for (const modifiers of [{ altKey: true, shiftKey: true }, { altKey: true, ctrlKey: true }, { altKey: true, metaKey: true }, {}]) {
      press(rowFor("B"), "ArrowDown", modifiers);
    }
    expect(onReorder).not.toHaveBeenCalled();
  });
});

describe("Alt+arrow on a row the reader may not move", () => {
  it("leaves the key alone and asks nothing, when the row has no Move among its actions", () => {
    const { onReorder } = render({ documentActions: () => [] });
    const event = press(rowFor("B"), "ArrowDown");
    expect(onReorder).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(said()).toBe("");
  });

  it("goes by the row's own actions, folder or document", () => {
    const folder: KnowledgeTreeItem = { type: "folder", id: "n:F", parentId: null, label: "F", position: 3, status: "ACTIVE" };
    const { onReorder } = render({ items: [...items, folder], folderActions: () => [moveAction("folder.move")] });
    press(rowFor("F"), "ArrowUp");
    expect(onReorder).toHaveBeenCalledWith({ nodeId: "n:F", position: 2 });
  });
});

describe("Alt+arrow while the tree is filtered", () => {
  it("says why nothing happens: the neighbours in a filtered tree are not the real ones", () => {
    const { onReorder } = render({ query: "B" });
    press(rowFor("B"), "ArrowDown");
    expect(said()).toBe("Clear the filter to reorder.");
    expect(onReorder).not.toHaveBeenCalled();
  });
});

describe("Alt+arrow while a request is in flight", () => {
  it("keeps the latest key and makes it against the tree that arrives, not the one that is about to be replaced", async () => {
    let finish: (ok: boolean) => void = () => {};
    const onReorder = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const { rerender } = render({ onReorder });

    press(rowFor("B"), "ArrowDown");
    expect(onReorder).toHaveBeenCalledTimes(1);
    // Two more while the first is on its way: only the last is kept.
    press(rowFor("B"), "ArrowDown");
    press(rowFor("B"), "ArrowUp");
    expect(onReorder).toHaveBeenCalledTimes(1);

    await act(async () => { finish(true); });
    expect(onReorder).toHaveBeenCalledTimes(1);

    // The tree arrives with B where the first step put it — last. Up is now a step from there.
    onReorder.mockImplementation(async () => true);
    rerender({ items: [doc("A", 0), doc("C", 1), doc("B", 2)] });
    expect(onReorder).toHaveBeenCalledTimes(2);
    expect(onReorder).toHaveBeenLastCalledWith({ nodeId: "n:B", position: 1 });
  });

  it("does not keep a key past a step the server refused", async () => {
    let finish: (ok: boolean) => void = () => {};
    const onReorder = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const { rerender } = render({ onReorder });
    press(rowFor("B"), "ArrowDown");
    press(rowFor("B"), "ArrowUp");
    await act(async () => { finish(false); });
    rerender({ items: [...items] });
    expect(onReorder).toHaveBeenCalledTimes(1);
  });
});

describe("the focus after a reorder", () => {
  it("is put back on the row that moved, for a browser that drops focus from a node the list re-places", async () => {
    const { rerender } = render();
    rowFor("B").focus();
    await act(async () => { rowFor("B").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true, cancelable: true })); });
    // What such a browser does when the list changes under the row: focus goes to the page.
    rowFor("B").blur();
    expect(document.activeElement).toBe(document.body);
    rerender({ items: [doc("A", 0), doc("C", 1), doc("B", 2)] });
    expect(document.activeElement).toBe(rowFor("B"));
  });

  it("is not taken anywhere when the server said no", async () => {
    const { rerender } = render({ onReorder: vi.fn(async () => false) });
    rowFor("B").focus();
    await act(async () => { rowFor("B").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true, cancelable: true })); });
    rowFor("B").blur();
    rerender({ items: [...items] });
    expect(document.activeElement).toBe(document.body);
  });
});

describe("the plain arrow keys", () => {
  it("still move the focus, and never reorder", () => {
    const { onReorder } = render();
    rowFor("A").focus();
    const event = press(rowFor("A"), "ArrowDown", {});
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(rowFor("B"));
    expect(onReorder).not.toHaveBeenCalled();
  });
});
