import { describe, expect, it } from "vitest";
import { dropPlacement } from "@/lib/knowledge-navigation";
import type { KnowledgeTreeItem } from "@/modules/knowledge/application/knowledge-query-service";

const doc = (label: string, position: number, parentId: string | null = null, status: "ACTIVE" | "ARCHIVED" = "ACTIVE"): KnowledgeTreeItem =>
  ({ type: "document", id: `n:${label}`, parentId, documentId: `d:${label}`, label, currentRevisionId: `r:${label}`, position, status });
const folder = (label: string, position: number, parentId: string | null = null, status: "ACTIVE" | "ARCHIVED" = "ACTIVE"): KnowledgeTreeItem =>
  ({ type: "folder", id: `n:${label}`, parentId, label, position, status });

// Hidden archived H sits between A and B; it is not in `items` because the client does not hold it.
const siblings = [doc("A", 0), doc("B", 2), doc("C", 3)];

describe("dropPlacement", () => {
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
});
