import { describe, expect, it } from "vitest";
import { buildKnowledgeTree, moveDestinations, reorderStep } from "@/lib/knowledge-navigation";
import type { KnowledgeTreeItem } from "@/modules/knowledge/application/knowledge-query-service";

let counter = 0;
const id = () => `node-${++counter}`;
function folder(label: string, parentId: string | null, position: number, status: "ACTIVE" | "ARCHIVED" = "ACTIVE"): KnowledgeTreeItem {
  return { type: "folder", id: `f:${label}`, parentId, label, position, status };
}
function doc(label: string, parentId: string | null, position: number, status: "ACTIVE" | "ARCHIVED" = "ACTIVE"): KnowledgeTreeItem {
  return { type: "document", id: `d:${label}`, parentId, documentId: `doc:${label}`, label, currentRevisionId: id(), position, status };
}

describe("where a node may be moved to", () => {
  // Top level: Inbox, Projects, Archive-me (archived), a document.
  //   Projects: Alpha, Beta;  Alpha: Deep;  Archive-me: Hidden
  const items: KnowledgeTreeItem[] = [
    folder("Projects", null, 1), folder("Inbox", null, 0), folder("Archive-me", null, 2, "ARCHIVED"), doc("Top note", null, 3),
    folder("Alpha", "f:Projects", 0), folder("Beta", "f:Projects", 1), folder("Deep", "f:Alpha", 0), folder("Hidden", "f:Archive-me", 0), doc("Inside", "f:Beta", 0),
  ];

  it("lists active folders in tree order, with how deep each is", () => {
    expect(moveDestinations(items, "d:Top note")).toEqual([
      { id: "f:Inbox", label: "Inbox", depth: 0 },
      { id: "f:Projects", label: "Projects", depth: 0 },
      { id: "f:Alpha", label: "Alpha", depth: 1 },
      { id: "f:Deep", label: "Deep", depth: 2 },
      { id: "f:Beta", label: "Beta", depth: 1 },
    ]);
  });

  it("leaves out an archived folder, and with it everything under it — an active folder inside an archived one is not a place", () => {
    const labels = moveDestinations(items, "d:Top note").map((destination) => destination.label);
    expect(labels).not.toContain("Archive-me");
    expect(labels).not.toContain("Hidden");
  });

  it("leaves out the folder being moved and everything inside it: a folder cannot go into its own subtree", () => {
    expect(moveDestinations(items, "f:Alpha").map((destination) => destination.label)).toEqual(["Inbox", "Projects", "Beta"]);
    expect(moveDestinations(items, "f:Projects").map((destination) => destination.label)).toEqual(["Inbox"]);
  });

  it("offers a folder's own parent, which is for the caller to mark as where it already is", () => {
    expect(moveDestinations(items, "d:Inside").map((destination) => destination.id)).toContain("f:Beta");
  });

  it("has no folders to offer when there are none", () => {
    expect(moveDestinations([doc("Only", null, 0)], "d:Only")).toEqual([]);
  });
});

describe("one step up or down among the siblings in view", () => {
  const roots = buildKnowledgeTree([doc("A", null, 0), doc("B", null, 1), doc("C", null, 2), folder("F", null, 3), doc("Inner 1", "f:F", 0), doc("Inner 2", "f:F", 1)]);

  it("asks for the neighbour's place, which puts the node on the other side of it", () => {
    expect(reorderStep(roots, "d:B", -1)).toEqual({ kind: "move", position: 0, index: 0, count: 4 });
    expect(reorderStep(roots, "d:B", 1)).toEqual({ kind: "move", position: 2, index: 2, count: 4 });
  });

  it("works inside a folder as well as at the top", () => {
    expect(reorderStep(roots, "d:Inner 1", 1)).toEqual({ kind: "move", position: 1, index: 1, count: 2 });
  });

  it("says it is at an edge rather than asking for a place that changes nothing", () => {
    expect(reorderStep(roots, "d:A", -1)).toEqual({ kind: "edge", index: 0, count: 4 });
    expect(reorderStep(roots, "f:F", 1)).toEqual({ kind: "edge", index: 3, count: 4 });
    expect(reorderStep(roots, "d:Inner 2", 1)).toEqual({ kind: "edge", index: 1, count: 2 });
  });

  it("has nothing to say about a node that is not in view", () => {
    expect(reorderStep(roots, "d:Nope", 1)).toBeNull();
  });

  it("goes by the neighbour's stored position, not by its index in view: an archived sibling between them is not in view", () => {
    // Stored: A0, (archived at 1, not in view), C2 — the tree given to the reader has only A and C.
    const inView = buildKnowledgeTree([doc("A", null, 0), doc("C", null, 2)]);
    expect(reorderStep(inView, "d:A", 1)).toEqual({ kind: "move", position: 2, index: 1, count: 2 });
    expect(reorderStep(inView, "d:C", -1)).toEqual({ kind: "move", position: 0, index: 0, count: 2 });
  });
});
