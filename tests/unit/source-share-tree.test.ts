import { describe, expect, it } from "vitest";
import { sharedForest } from "@/modules/knowledge/application/document-share-service";
import type { TreeViewNode } from "@/modules/knowledge/ports/tree-repository";

const SOURCE = "0192f3a4-5b6c-7d8e-9f01-000000000000";

/**
 * `sharedForest` builds the Source link's tree from `TreeRepository.listBySource`'s rows: every
 * node of the Source in the owner's sibling order (position, then id), re-rooted at `parentId`
 * null (a Source has no root node). Depth-first in that order, archived subtrees dropped, and
 * nothing deeper than the depth cap — the cap `listSubtree` uses, so every shown document is one
 * the reachability check can still prove (source share spec §3).
 */
function node(overrides: Partial<TreeViewNode> & Pick<TreeViewNode, "id" | "parentId" | "nodeType">): TreeViewNode {
  return {
    sourceId: SOURCE,
    name: null,
    documentId: null,
    position: 0,
    status: "ACTIVE",
    updatedBy: "u",
    archivedBy: null,
    archivedAt: null,
    title: null,
    pageIcon: null,
    documentStatus: null,
    currentRevisionId: null,
    ...overrides,
  };
}

function folder(id: string, parentId: string | null, name: string, position = 0): TreeViewNode {
  return node({ id, parentId, nodeType: "FOLDER", name, position });
}

function document(id: string, parentId: string | null, title: string, documentId: string, position = 0): TreeViewNode {
  return node({ id, parentId, nodeType: "DOCUMENT", title, documentId, documentStatus: "ACTIVE", currentRevisionId: `rev-${id}`, position });
}

describe("sharedForest", () => {
  it("lists top-level documents and folders depth-first in position order, with parentId null at the root", () => {
    const welcome = document("n-welcome", null, "Welcome", "d-welcome", 0);
    const engineering = folder("n-eng", null, "Engineering", 1);
    const devSetup = document("n-setup", "n-eng", "Dev setup", "d-setup", 0);
    const codeReview = document("n-review", "n-eng", "Code review", "d-review", 1);
    const faq = document("n-faq", null, "FAQ", "d-faq", 2);

    const forest = sharedForest([welcome, engineering, faq, devSetup, codeReview], 998);

    expect(forest.map((n) => [n.name, n.kind, n.parentId])).toEqual([
      ["Welcome", "DOCUMENT", null],
      ["Engineering", "FOLDER", null],
      ["Dev setup", "DOCUMENT", "n-eng"],
      ["Code review", "DOCUMENT", "n-eng"],
      ["FAQ", "DOCUMENT", null],
    ]);
  });

  it("breaks equal-position siblings by id, the same on every call", () => {
    const first = document("n-a", null, "A", "d-a", 0);
    const second = document("n-b", null, "B", "d-b", 0);
    const third = document("n-c", null, "C", "d-c", 0);
    const ids = [first, second, third].map((n) => n.id).sort();

    const forest = sharedForest([third, second, first], 998);
    expect(forest.map((n) => n.id)).toEqual(ids);
  });

  it("omits an archived folder and everything under it", () => {
    const welcome = document("n-welcome", null, "Welcome", "d-welcome", 0);
    const archived = { ...folder("n-archived", null, "Archived", 1), status: "ARCHIVED" as const };
    const child = document("n-child", "n-archived", "Child", "d-child", 0);
    const faq = document("n-faq", null, "FAQ", "d-faq", 2);

    const forest = sharedForest([welcome, archived, faq, child], 998);
    expect(forest.map((n) => n.name)).toEqual(["Welcome", "FAQ"]);
  });

  it("omits a node deeper than maxDepth, including its descendants", () => {
    const a = folder("n-a", null, "A", 0);
    const b = folder("n-b", "n-a", "B", 1);
    const c = document("n-c", "n-b", "C", "d-c", 0);

    // Top-level nodes (depth 0) only: A survives, B and C do not.
    expect(sharedForest([a, b, c], 0).map((n) => n.name)).toEqual(["A"]);

    // Depth 1 included, depth 2 dropped: A, D and B survive, C does not.
    const d = document("n-d", "n-a", "D", "d-d", 0);
    expect(sharedForest([a, b, d, c], 1).map((n) => n.name)).toEqual(["A", "D", "B"]);
  });

  it("omits a document whose document row is archived or has no current revision", () => {
    const active = document("n-active", null, "Active", "d-active", 0);
    const archivedDoc = { ...document("n-archived", null, "Archived doc", "d-archived", 1), documentStatus: "ARCHIVED" as const };
    const noRevision = { ...document("n-no-rev", null, "No revision", "d-no-rev", 2), currentRevisionId: null };
    const noDocumentRow = { ...document("n-no-doc", null, "No document", "d-none", 3), documentId: null };

    const forest = sharedForest([active, archivedDoc, noRevision, noDocumentRow], 998);
    expect(forest.map((n) => n.name)).toEqual(["Active"]);
  });
});
