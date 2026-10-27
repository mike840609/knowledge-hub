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

const doc = (label: string, position: number): KnowledgeTreeItem => ({
  type: "document", id: `n:${label}`, parentId: null, documentId: `d:${label}`, label, currentRevisionId: `r:${label}`, position, status: "ACTIVE",
});
const items = [doc("A", 0), doc("B", 1), doc("C", 2)];

const action = (id: Action["id"]): Action => ({
  id, label: id, group: "document", icon: "open", keywords: [], surfaces: ["row"],
  effect: { kind: "navigate", href: "/x" },
});
const actions = [action("document.favorite"), action("document.move"), action("document.archive")];

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

function render(overrides: Partial<ComponentProps<typeof KnowledgeTree>> = {}) {
  const onBulkFavorite = vi.fn();
  const onBulkMove = vi.fn();
  const onBulkArchive = vi.fn();
  act(() =>
    root.render(
      createElement(KnowledgeTree, {
        items,
        workspaceId: "w1",
        sourceId: "s1",
        favoriteDocumentIds: new Set<string>(),
        onToggleFavorite: () => {},
        documentActions: () => actions,
        folderActions: () => [],
        onRunAction: () => {},
        onReorder: async () => true,
        onBulkFavorite,
        onBulkMove,
        onBulkArchive,
        ...overrides,
      }),
    ),
  );
  return { onBulkFavorite, onBulkMove, onBulkArchive };
}

const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
function click(label: string, shiftKey = false) {
  const element = button(label);
  expect(element).toBeTruthy();
  act(() => { element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey })); });
}

describe("multi-select in the explorer", () => {
  it("selects a row, extends by shift-click, and reports the selected documents", () => {
    const callbacks = render();
    click("Select A");
    expect(container.textContent).toContain("1 selected");
    click("Select C", true);
    expect(container.textContent).toContain("3 selected");
    click("Add selected to favorites");
    expect(callbacks.onBulkFavorite).toHaveBeenCalledWith(
      [{ documentId: "d:A", label: "A" }, { documentId: "d:B", label: "B" }, { documentId: "d:C", label: "C" }],
      true,
    );
    click("Move selected documents");
    expect(callbacks.onBulkMove).toHaveBeenCalledTimes(1);
    click("Archive selected documents");
    expect(callbacks.onBulkArchive).toHaveBeenCalledTimes(1);
  });

  it("clears the selection with Escape", () => {
    render();
    click("Select A");
    expect(container.textContent).toContain("1 selected");
    const tree = container.querySelector('[role="tree"]')!;
    act(() => { tree.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(container.textContent).not.toContain("1 selected");
    expect(button("Clear selection")).toBeNull();
  });

  it("offers removal when every selected document is already a favorite", () => {
    const callbacks = render({ favoriteDocumentIds: new Set(["d:A", "d:B"]) });
    click("Select A");
    click("Select B", true);
    click("Remove selected from favorites");
    expect(callbacks.onBulkFavorite).toHaveBeenCalledWith(
      [{ documentId: "d:A", label: "A" }, { documentId: "d:B", label: "B" }],
      false,
    );
  });
});
