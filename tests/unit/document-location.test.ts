import { describe, expect, it } from "vitest";
import type { KnowledgeTreeItem } from "@/modules/knowledge/application/knowledge-query-service";
import { documentLocation } from "@/server/document-location";

function folder(id: string, label: string, parentId: string | null): KnowledgeTreeItem {
  return { type: "folder", id, parentId, label, position: 0, status: "ACTIVE" };
}
function doc(id: string, documentId: string, parentId: string | null): KnowledgeTreeItem {
  return { type: "document", id, parentId, documentId, label: "Doc", currentRevisionId: "rev", position: 0, status: "ACTIVE" };
}

describe("documentLocation", () => {
  it("leads from the source through every folder, outermost first, and stops before the document", () => {
    const tree = [folder("f1", "HR", null), folder("f2", "Leave", "f1"), doc("n1", "d1", "f2")];
    expect(documentLocation("w", "s", "Notes", tree, "d1")).toEqual([
      { label: "Notes", href: "/w/w/knowledge/s" },
      { label: "HR" },
      { label: "Leave" },
    ]);
  });

  it("is just the source for a document at the root or not in the tree", () => {
    expect(documentLocation("w", "s", "Notes", [doc("n1", "d1", null)], "d1")).toEqual([{ label: "Notes", href: "/w/w/knowledge/s" }]);
    expect(documentLocation("w", "s", "Notes", [], "missing")).toEqual([{ label: "Notes", href: "/w/w/knowledge/s" }]);
  });
});
