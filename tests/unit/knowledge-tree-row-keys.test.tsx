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

  it("takes E and F on a folder row too, for the document being read must not answer them", () => {
    const { onRunAction } = render({ folderActions: () => [newHereAction] });
    for (const key of ["e", "f"]) {
      const event = press(rowFor("F"), key);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(onRunAction).not.toHaveBeenCalled();
  });

  it("still runs the folder's own C, and leaves C on a document row alone", () => {
    const { onRunAction } = render();
    const folderEvent = press(rowFor("F"), "c");
    expect(folderEvent.defaultPrevented).toBe(true);
    expect(onRunAction).toHaveBeenCalledTimes(1);
    expect(onRunAction).toHaveBeenCalledWith(newHereAction);
    expect(press(rowFor("A"), "c").defaultPrevented).toBe(false);
    expect(onRunAction).toHaveBeenCalledTimes(1);
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

  it("does not act on a key that came from a menu inside the row", () => {
    const { onRunAction } = render();
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("div");
    menu.appendChild(item);
    // Inside the row's subtree, so the event reaches the tree's handler and only the menu guard stops it.
    rowFor("A").appendChild(menu);
    const event = press(item, "e");
    expect(onRunAction).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("j and k", () => {
  it("are not moves when typed into a field inside the row", () => {
    render();
    act(() => rowFor("A").focus());
    const input = document.createElement("input");
    rowFor("A").appendChild(input);
    const event = press(input, "j");
    expect(document.activeElement).toBe(rowFor("A"));
    expect(event.defaultPrevented).toBe(false);
  });

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
