import { describe, expect, it } from "vitest";
import {
  buildKnowledgeTree,
  filterKnowledgeTree,
  findFirstReadableDocument,
  sortSourcesByName,
} from "@/lib/knowledge-navigation";
import type {
  KnowledgeTreeItem,
  SourceView,
} from "@/modules/knowledge/application/knowledge-query-service";

describe("Phase 2.5 Knowledge navigation", () => {
  it("sorts Sources by name with an id tie-breaker", () => {
    const sources = [
      { id: "b", workspaceId: "w", name: "Wiki", sourceType: "HUB", ownership: "HUB_MANAGED", status: "ACTIVE", syncVersion: 0 },
      { id: "c", workspaceId: "w", name: "Architecture", sourceType: "HUB", ownership: "HUB_MANAGED", status: "ACTIVE", syncVersion: 0 },
      { id: "a", workspaceId: "w", name: "Wiki", sourceType: "HUB", ownership: "HUB_MANAGED", status: "ACTIVE", syncVersion: 0 },
    ] satisfies SourceView[];

    expect(sortSourcesByName(sources).map((source) => source.id))
      .toEqual(["c", "a", "b"]);
  });

  it("finds the first document using Tree position order", () => {
    const items: KnowledgeTreeItem[] = [
      { type: "folder", id: "folder-b", parentId: null, label: "B", position: 1, status: "ACTIVE" },
      { type: "document", id: "doc-node-b", parentId: "folder-b", documentId: "doc-b", label: "B doc", currentRevisionId: "r-b", position: 0, status: "ACTIVE" },
      { type: "folder", id: "folder-a", parentId: null, label: "A", position: 0, status: "ACTIVE" },
      { type: "document", id: "doc-node-a", parentId: "folder-a", documentId: "doc-a", label: "A doc", currentRevisionId: "r-a", position: 0, status: "ACTIVE" },
    ];

    expect(findFirstReadableDocument(items)?.documentId).toBe("doc-a");
  });

  it("keeps matching ancestors when filtering", () => {
    const roots = buildKnowledgeTree([
      { type: "folder", id: "architecture", parentId: null, label: "Architecture", position: 0, status: "ACTIVE" },
      { type: "document", id: "auth-node", parentId: "architecture", documentId: "auth", label: "Authentication", currentRevisionId: "r1", position: 0, status: "ACTIVE" },
      { type: "document", id: "db-node", parentId: "architecture", documentId: "db", label: "Database", currentRevisionId: "r2", position: 1, status: "ACTIVE" },
    ]);

    const filtered = filterKnowledgeTree(roots, "auth");

    expect(filtered).toHaveLength(1);
    expect(filtered[0].item.label).toBe("Architecture");
    expect(filtered[0].children.map((node) => node.item.label))
      .toEqual(["Authentication"]);
  });
});
